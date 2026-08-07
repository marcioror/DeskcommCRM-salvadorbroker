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

/**
 * A rota faz DUAS queries (`crm_lead_links` depois `properties`) — não um
 * embed PostgREST, que não é resolvível aqui (ver comentário no route.ts:
 * `target_id` é polimórfico, sem FK única pra `properties`). O mock precisa
 * de uma chain POR TABELA pra provar isso: `linksRows`/`linksError` respondem
 * ao `.from("crm_lead_links")`, `propsRows`/`propsError` ao
 * `.from("properties")`. Registra todo `.eq()`/`.in()` por chamada — um bug
 * que solte o filtro de `organization_id` (ou `lead_id`/`target_kind`/
 * `link_kind`/o segundo `organization_id` na query de properties) tem que
 * derrubar o teste, não passar em silêncio.
 */
function makeDb(opts: {
  linksRows?: unknown[];
  linksError?: { message: string } | null;
  propsRows?: unknown[];
  propsError?: { message: string } | null;
}) {
  const { linksRows = [], linksError = null, propsRows = [], propsError = null } = opts;
  const calls: Record<string, Array<[string, unknown]>> = { crm_lead_links: [], properties: [] };

  function makeChain(table: "crm_lead_links" | "properties", rows: unknown[], error: unknown) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => {
      calls[table]!.push([col, val]);
      return chain;
    });
    chain.in = vi.fn((col: string, val: unknown) => {
      calls[table]!.push([col, val]);
      return chain;
    });
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error });
    return chain;
  }

  const linksChain = makeChain("crm_lead_links", linksRows, linksError);
  const propsChain = makeChain("properties", propsRows, propsError);
  const supabase = {
    from: vi.fn((table: string) => (table === "crm_lead_links" ? linksChain : propsChain)),
  };
  return { supabase, calls };
}

describe("GET /api/v1/leads/[id]/properties", () => {
  it("viewer consegue ler (role mínima é viewer); filtra tenant/escopo nas duas queries", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase, calls } = makeDb({
      linksRows: [{ target_id: PROP_ID, created_at: "2026-08-01T00:00:00.000Z" }],
      propsRows: [
        { id: PROP_ID, title: "Casa X", status: "available", price_sale_cents: 50000000, price_rent_cents: null },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(200);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("viewer");

    // crm_lead_links: tenant + lead + tipo de vínculo.
    expect(calls.crm_lead_links).toContainEqual(["organization_id", ORG_ID]);
    expect(calls.crm_lead_links).toContainEqual(["lead_id", LEAD_ID]);
    expect(calls.crm_lead_links).toContainEqual(["target_kind", "property"]);
    expect(calls.crm_lead_links).toContainEqual(["link_kind", "interested_in"]);

    // properties: tenant de novo (segunda query, mesmo isolamento) + o filtro
    // pelos ids vindos do primeiro round-trip.
    expect(calls.properties).toContainEqual(["organization_id", ORG_ID]);
    expect(calls.properties).toContainEqual(["id", [PROP_ID]]);
  });

  it("NÃO usa embed PostgREST — não pede `properties(...)` num único .select() em crm_lead_links", async () => {
    // Regressão direta do bug real (Task 14): `target_id` é polimórfico, sem
    // FK única pra `properties`, então um embed nessa forma falha em runtime
    // com PGRST200 contra um Postgres de verdade — mock nenhum pega isso por
    // simular o retorno já resolvido. A prova aqui é estrutural: a chain de
    // `crm_lead_links` só pode receber `.select()` com colunas de
    // crm_lead_links, nunca com `properties(`.
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase } = makeDb({});
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    await GET(new Request("http://localhost"), ctx as never);

    const linksChain = (supabase.from as ReturnType<typeof vi.fn>).mock.results.find(
      (r, i) => (supabase.from as ReturnType<typeof vi.fn>).mock.calls[i]?.[0] === "crm_lead_links",
    )?.value as { select: ReturnType<typeof vi.fn> };
    const selectArgs = linksChain.select.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(selectArgs.some((s: string) => s.includes("properties("))).toBe(false);
  });

  it("retorna a lista de imóveis vinculados, mapeada (properties resolvido pela segunda query)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase } = makeDb({
      linksRows: [{ target_id: PROP_ID, created_at: "2026-08-01T00:00:00.000Z" }],
      propsRows: [
        { id: PROP_ID, title: "Casa X", status: "available", price_sale_cents: 500000_00, price_rent_cents: null },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(body.data).toEqual([
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
    ]);
  });

  it("vínculo órfão (imóvel desapareceu) vira properties:null, não quebra a resposta", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase } = makeDb({
      linksRows: [{ target_id: PROP_ID, created_at: "2026-08-01T00:00:00.000Z" }],
      propsRows: [], // properties já não existe (nunca deveria acontecer via API, mas a rota não deve 500 nesse caso)
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ properties: unknown }> };
    expect(body.data[0]?.properties).toBeNull();
  });

  it("sem vínculos, retorna [] sem chamar a query de properties", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase, calls } = makeDb({ linksRows: [] });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(body.data).toEqual([]);
    expect(calls.properties).toEqual([]);
  });

  it("erro do banco na query de vínculos vira 500", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase } = makeDb({ linksError: { message: "boom" } });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(500);
  });

  it("erro do banco na query de properties vira 500", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase } = makeDb({
      linksRows: [{ target_id: PROP_ID, created_at: "2026-08-01T00:00:00.000Z" }],
      propsError: { message: "boom" },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(500);
  });
});
