import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROP_ID = "33333333-3333-3333-3333-333333333333";
// Zod v4 `.uuid()` valida o nibble de variante RFC4122 (posição 17 deve ser
// 8/9/a/b) — "4444-4444..." repetido falharia com "Invalid UUID".
const LEAD_ID = "44444444-4444-4444-8444-444444444444";
const USER = { id: "22222222-2222-2222-2222-222222222222" };
const ctx = { params: Promise.resolve({ id: PROP_ID }) };

beforeEach(() => vi.clearAllMocks());

function makeDb(opts: { propertyExists: boolean; leadExists: boolean; linkExists: boolean }) {
  const inserts: unknown[] = [];
  const tables: Record<string, unknown> = {
    properties: opts.propertyExists ? { id: PROP_ID } : null,
    crm_leads: opts.leadExists ? { id: LEAD_ID, title: "Lead X", contact_id: null } : null,
  };
  const supabase = {
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => {
        if (table === "crm_lead_links") return { data: opts.linkExists ? { id: "link-1" } : null, error: null };
        return { data: tables[table] ?? null, error: null };
      });
      chain.insert = vi.fn((row: unknown) => {
        inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: "link-1", ...(row as object) }, error: null }) }) };
      });
      return chain;
    }),
  };
  return { supabase, inserts };
}

describe("POST /api/v1/properties/[id]/leads", () => {
  it("viewer não consegue vincular (403, nenhum insert)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= agent.", 403, {}),
    } as never);
    const { supabase, inserts } = makeDb({ propertyExists: true, leadExists: true, linkExists: false });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost", { method: "POST", body: JSON.stringify({ lead_id: LEAD_ID }) });
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(403);
    expect(inserts).toEqual([]);
  });

  it("404 quando o lead não pertence à org ativa", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, user: USER, org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase } = makeDb({ propertyExists: true, leadExists: false, linkExists: false });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost", { method: "POST", body: JSON.stringify({ lead_id: LEAD_ID }) });
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(404);
  });

  it("409 quando o vínculo já existe (evita duplicar)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, user: USER, org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase } = makeDb({ propertyExists: true, leadExists: true, linkExists: true });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost", { method: "POST", body: JSON.stringify({ lead_id: LEAD_ID }) });
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(409);
  });

  it("agent vincula: insere em crm_lead_links E em crm_lead_activities", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, user: USER, org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase, inserts } = makeDb({ propertyExists: true, leadExists: true, linkExists: false });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost", { method: "POST", body: JSON.stringify({ lead_id: LEAD_ID }) });
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(201);
    expect(inserts.some((i) => (i as { table: string }).table === "crm_lead_links")).toBe(true);
    expect(inserts.some((i) => (i as { table: string }).table === "crm_lead_activities")).toBe(true);
  });
});
