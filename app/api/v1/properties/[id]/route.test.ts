import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROP_ID = "33333333-3333-3333-3333-333333333333";
const USER = { id: "22222222-2222-2222-2222-222222222222" };
const ctx = { params: Promise.resolve({ id: PROP_ID }) };

function makeDb(existing: Record<string, unknown> | null) {
  const updates: unknown[] = [];
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: existing, error: null }));
  chain.update = vi.fn((patch: unknown) => {
    updates.push(patch);
    // Chainable like the real Supabase builder — the route now calls
    // `.eq("id", id).eq("organization_id", activeOrg.orgId)` (two `.eq()`s)
    // before `.select().single()`, so this must support repeated `.eq()`.
    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn(() => updateChain);
    updateChain.select = vi.fn(() => ({
      single: async () => ({ data: { ...existing, ...(patch as object) }, error: null }),
    }));
    return updateChain;
  });
  const supabase = { from: vi.fn(() => chain) };
  return { supabase, updates };
}

beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/v1/properties/[id] (soft)", () => {
  it("viewer não consegue desativar (403, nenhum update)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= agent.", 403, {}),
    } as never);
    const { supabase, updates } = makeDb({ id: PROP_ID, status: "available" });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(403);
    expect(updates).toEqual([]);
  });

  it("agent desativa: status vira 'inactive' via update, nunca DELETE físico", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase, updates } = makeDb({ id: PROP_ID, status: "available" });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ status: "inactive" });
  });

  it("404 quando o imóvel não existe na org ativa", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase } = makeDb(null);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(404);
  });
});
