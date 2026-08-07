import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const USER = { id: "22222222-2222-2222-2222-222222222222" };

function makeDb(rows: unknown[] = []) {
  const inserted: unknown[] = [];
  // Records every .eq(col, val) call so a bug that drops the organization_id
  // tenant filter (or any other .eq() filter) actually fails a test instead
  // of silently passing — chain.eq() alone doesn't prove the filter is used.
  const eqCalls: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  const terminal = { data: rows, error: null };
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  });
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(async () => terminal);
  chain.insert = vi.fn((row: unknown) => {
    inserted.push(row);
    return {
      select: () => ({
        single: async () => ({ data: { id: "prop-1", ...(row as object) }, error: null }),
      }),
    };
  });
  const supabase = { from: vi.fn(() => chain) };
  return { supabase, inserted, eqCalls };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/v1/properties", () => {
  it("viewer consegue listar (role mínima é viewer)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase, eqCalls } = makeDb([]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/properties"));
    expect(res.status).toBe(200);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("viewer");
    // Tenant isolation: a bug that drops the .eq("organization_id", ...)
    // filter must fail this test.
    expect(eqCalls).toContainEqual(["organization_id", ORG_ID]);
  });
});

describe("POST /api/v1/properties", () => {
  it("viewer não consegue criar (403, nenhum insert)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= agent.", 403, {}),
    } as never);
    const { supabase, inserted } = makeDb();
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/v1/properties", {
      method: "POST",
      body: JSON.stringify({ title: "Casa", property_type: "house", purpose: "sale" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(inserted).toEqual([]);
  });

  it("agent cria com sucesso e chama requireRole com 'agent'", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase, inserted } = makeDb();
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/v1/properties", {
      method: "POST",
      body: JSON.stringify({ title: "Casa", property_type: "house", purpose: "sale" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("agent");
    expect(inserted[0]).toMatchObject({ organization_id: ORG_ID, title: "Casa" });
  });
});
