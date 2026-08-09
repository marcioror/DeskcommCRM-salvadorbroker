/**
 * Task 8.6 — a fila mostra o agente PINADO no enrollment. Prova a função pura
 * de mapeamento `enrollmentToQueueRow` (o join `ai_agents:agent_id(name)` da
 * rota vira `agent_name`), cobrindo o embed do PostgREST nos dois formatos
 * (objeto único e array de 1) + ausência de agente pinado → null.
 */
import { describe, it, expect, vi } from "vitest";

// A rota importa server-only helpers no topo; mocka-se pra o import não puxar
// next/headers em ambiente jsdom. Só a função PURA é exercida.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));

import { enrollmentToQueueRow } from "@/app/api/v1/ai/followups/queue/route";
import type { Actor } from "@/lib/api/handlers/types";

// manager: irrelevante pra estes testes (agent_name), mas precisa ser alguém
// que `podeVerContatoSensivel` sempre aprova — I1 fez `enrollmentToQueueRow`
// exigir o ator pra decidir se o rótulo do contato pode cair no telefone.
const MANAGER: Actor = { type: "user", id: "tester", role: "manager" };

const base = {
  id: "e1",
  contact_id: "c1",
  current_node_id: "n1",
  next_eval_at: "2026-07-23T00:00:00Z",
  status: "active",
  outcome: null,
  contacts: { id: "c1", name: "Ana", display_name: null, phone_number: null, created_by_user_id: null },
  followup_flow_pointers: { name: "Reativação" },
  ai_agents: null,
};

describe("enrollmentToQueueRow — agent_name", () => {
  it("agente pinado (embed objeto) → agent_name", () => {
    const row = enrollmentToQueueRow({ ...base, ai_agents: { name: "Vendedor IA" } }, MANAGER);
    expect(row.agent_name).toBe("Vendedor IA");
    expect(row.flow_name).toBe("Reativação");
    expect(row.contact.name).toBe("Ana");
  });

  it("agente pinado (embed array de 1, como o PostgREST às vezes devolve) → agent_name", () => {
    const row = enrollmentToQueueRow({ ...base, ai_agents: [{ name: "Vendedor IA" }] }, MANAGER);
    expect(row.agent_name).toBe("Vendedor IA");
  });

  it("sem agente pinado (agent_id null) → agent_name null", () => {
    const row = enrollmentToQueueRow({ ...base, ai_agents: null }, MANAGER);
    expect(row.agent_name).toBeNull();
  });
});

// I1 (revisão final): `rotuloDoContato` cai pro telefone quando não há nome —
// sem gate de visibilidade, um lead sem nome que o ator NÃO cadastrou aparecia
// na fila TITULADO pelo próprio telefone, o mesmo dado que /api/v1/contacts
// já protege na resposta.
describe("enrollmentToQueueRow — proteção de telefone no rótulo (I1)", () => {
  const CRIADOR = "11111111-1111-4111-8111-111111111111";
  const OUTRO_AGENT: Actor = { type: "user", id: "22222222-2222-4222-8222-222222222222", role: "agent" };
  const contatoSemNome = {
    id: "c1",
    name: null,
    display_name: null,
    phone_number: "+5531988887777",
    created_by_user_id: CRIADOR,
  };

  it("agent que NÃO cadastrou o lead sem nome vê SEM_NOME, nunca o telefone", () => {
    const row = enrollmentToQueueRow({ ...base, contacts: contatoSemNome }, OUTRO_AGENT);
    expect(row.contact.name).toBe("Sem nome");
    expect(row.contact.name).not.toContain("5531988887777");
  });

  it("agent que cadastrou o próprio lead sem nome vê o telefone no rótulo (comportamento normal)", () => {
    const criador: Actor = { type: "user", id: CRIADOR, role: "agent" };
    const row = enrollmentToQueueRow({ ...base, contacts: contatoSemNome }, criador);
    expect(row.contact.name).toBe("+5531988887777");
  });

  it("manager vê o telefone no rótulo mesmo sem ter cadastrado o lead", () => {
    const row = enrollmentToQueueRow({ ...base, contacts: contatoSemNome }, MANAGER);
    expect(row.contact.name).toBe("+5531988887777");
  });
});
