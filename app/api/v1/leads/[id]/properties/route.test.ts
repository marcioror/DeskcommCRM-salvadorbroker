import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";
const PROP_ID = "33333333-3333-3333-3333-333333333333";
const USER = { id: "22222222-2222-2222-2222-222222222222" };
const ctx = { params: Promise.resolve({ id: LEAD_ID }) };

beforeEach(() => vi.clearAllMocks());

function makeDb(rows: unknown[] = []) {
  // Records every .eq(col, val) call so a bug that drops the organization_id
  // (or lead_id/target_kind/link_kind) tenant/scope filter actually fails a
  // test instead of silently passing.
  const eqCalls: Array<[string, unknown]> = [];
  const terminal = { data: rows, error: null };
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  });
  // supabase-js query builders are thenable — awaiting the chain directly
  // (no terminal .then()/.limit()/.single() call in the route) resolves it.
  chain.then = (resolve: (v: unknown) => void) => resolve(terminal);
  const supabase = { from: vi.fn(() => chain) };
  return { supabase, eqCalls };
}

describe("GET /api/v1/leads/[id]/properties", () => {
  it("viewer consegue ler (role mínima é viewer)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase, eqCalls } = makeDb([]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(200);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("viewer");
    // Tenant + scope isolation: a bug that drops any of these filters must
    // fail this test.
    expect(eqCalls).toContainEqual(["organization_id", ORG_ID]);
    expect(eqCalls).toContainEqual(["lead_id", LEAD_ID]);
    expect(eqCalls).toContainEqual(["target_kind", "property"]);
    expect(eqCalls).toContainEqual(["link_kind", "interested_in"]);
  });

  it("retorna a lista de imóveis vinculados, mapeada", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const rows = [
      {
        target_id: PROP_ID,
        created_at: "2026-08-01T00:00:00.000Z",
        properties: {
          id: PROP_ID,
          title: "Casa X",
          status: "available",
          price_sale_cents: 500000_00,
          price_rent_cents: null,
        },
      },
    ];
    const { supabase } = makeDb(rows);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(body.data).toEqual(rows);
  });

  it("erro do banco vira 500", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: "boom" } });
    const supabase = { from: vi.fn(() => chain) };
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(500);
  });
});
