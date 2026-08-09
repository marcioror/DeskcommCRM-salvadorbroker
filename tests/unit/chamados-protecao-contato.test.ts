/**
 * C2 (revisão final de feat/protecao-contato-corretor): `listarChamados` e
 * `lerChamado` rodam com client SERVICE-ROLE (RLS bypassada) atrás de um gate
 * de rota que só exige `agent` — sem aplicar `podeVerContatoSensivel` aqui
 * qualquer agente via GET /api/v1/ai/cases enxergava o telefone cru de um lead
 * que não cadastrou.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listarChamados, lerChamado } from "@/lib/escalacao/chamados";
import type { Actor } from "@/lib/api/handlers/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const CRIADOR = "22222222-2222-4222-8222-222222222222";
const OUTRO_AGENT = "33333333-3333-4333-8333-333333333333";
const CASE_ID = "44444444-4444-4444-8444-444444444444";

function chamadoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    title: "Desconto especial",
    summary: "Cliente quer 20%",
    blocker: "Alçada",
    status: "awaiting_human",
    source: "agent",
    opened_at: "2026-08-01T10:00:00Z",
    closed_at: null,
    conversation_id: "conv-1",
    conversations: {
      contacts: { name: "Fulano", phone_number: "+5531988887777", created_by_user_id: CRIADOR },
    },
    ...overrides,
  };
}

/** Duplo mínimo: `agent_cases` devolve as linhas passadas, `agent_case_events` devolve []. */
function fakeSupabase(rows: ReturnType<typeof chamadoRow>[]) {
  const client = {
    from(table: string) {
      if (table === "agent_case_events") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
          }),
        };
      }
      if (table !== "agent_cases") throw new Error(`fake_supabase: tabela inesperada '${table}'`);
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: typeof rows; error: null; count: number }) => void) =>
          resolve({ data: rows, error: null, count: rows.length }),
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

const AGENT_QUE_NAO_CADASTROU: Actor = { type: "user", id: OUTRO_AGENT, role: "agent" };
const AGENT_CRIADOR: Actor = { type: "user", id: CRIADOR, role: "agent" };
const MANAGER: Actor = { type: "user", id: OUTRO_AGENT, role: "manager" };

describe("listarChamados — proteção de telefone do contato", () => {
  it("agent que não cadastrou o lead recebe contact_phone nulo e contact_protected=true", async () => {
    const supabase = fakeSupabase([chamadoRow()]);
    const { chamados } = await listarChamados(
      supabase,
      ORG,
      { estado: "abertos" },
      AGENT_QUE_NAO_CADASTROU,
    );
    expect(chamados[0]?.contact_phone).toBeNull();
    expect(chamados[0]?.contact_protected).toBe(true);
    // nome continua — é o que dá utilidade à fila sem expor o dado sensível.
    expect(chamados[0]?.contact_name).toBe("Fulano");
  });

  it("agent que cadastrou o próprio lead vê o telefone normalmente", async () => {
    const supabase = fakeSupabase([chamadoRow()]);
    const { chamados } = await listarChamados(supabase, ORG, { estado: "abertos" }, AGENT_CRIADOR);
    expect(chamados[0]?.contact_phone).toBe("+5531988887777");
    expect(chamados[0]?.contact_protected).toBe(false);
  });

  it("manager vê o telefone mesmo sem ter cadastrado o lead", async () => {
    const supabase = fakeSupabase([chamadoRow()]);
    const { chamados } = await listarChamados(supabase, ORG, { estado: "abertos" }, MANAGER);
    expect(chamados[0]?.contact_phone).toBe("+5531988887777");
    expect(chamados[0]?.contact_protected).toBe(false);
  });
});

describe("lerChamado — proteção de telefone do contato", () => {
  it("agent que não cadastrou o lead recebe o detalhe do caso com telefone nulo", async () => {
    const supabase = fakeSupabase([chamadoRow()]);
    const chamado = await lerChamado(supabase, ORG, CASE_ID, AGENT_QUE_NAO_CADASTROU);
    expect(chamado?.contact_phone).toBeNull();
    expect(chamado?.contact_protected).toBe(true);
  });
});
