import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROP_ID = "33333333-3333-3333-3333-333333333333";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";
const USER = { id: "22222222-2222-2222-2222-222222222222" };
const ctx = { params: Promise.resolve({ id: PROP_ID, leadId: LEAD_ID }) };

beforeEach(() => vi.clearAllMocks());

function makeDb(opts: { linkExists: boolean }) {
  const inserts: unknown[] = [];
  const deletes: unknown[] = [];
  const supabase = {
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => {
        if (table === "crm_lead_links") return { data: opts.linkExists ? { id: "link-1" } : null, error: null };
        return { data: null, error: null };
      });
      chain.delete = vi.fn(() => {
        deletes.push({ table });
        return chain;
      });
      chain.insert = vi.fn((row: unknown) => {
        inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: "x", ...(row as object) }, error: null }) }) };
      });
      return chain;
    }),
  };
  return { supabase, inserts, deletes };
}

describe("DELETE /api/v1/properties/[id]/leads/[leadId]", () => {
  it("viewer não consegue desvincular (403, nenhum delete)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= agent.", 403, {}),
    } as never);
    const { supabase, deletes } = makeDb({ linkExists: true });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), ctx as never);
    expect(res.status).toBe(403);
    expect(deletes).toEqual([]);
  });

  it("404 quando o vínculo não existe", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, user: USER, org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase } = makeDb({ linkExists: false });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), ctx as never);
    expect(res.status).toBe(404);
  });

  it("agent desvincula: 204, delete em crm_lead_links e insert em crm_lead_activities", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, user: USER, org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase, deletes, inserts } = makeDb({ linkExists: true });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost", { method: "DELETE" }), ctx as never);
    expect(res.status).toBe(204);
    expect(deletes.some((d) => (d as { table: string }).table === "crm_lead_links")).toBe(true);
    expect(inserts.some((i) => (i as { table: string }).table === "crm_lead_activities")).toBe(true);
  });
});
