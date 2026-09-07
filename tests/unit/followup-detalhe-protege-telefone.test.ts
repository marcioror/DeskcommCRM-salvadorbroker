import { describe, expect, it, vi, beforeEach } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

/**
 * O DETALHE DO FOLLOW-UP ERA O ÚLTIMO LUGAR DA FEATURE QUE AINDA ESCREVIA O
 * TELEFONE DE UM LEAD PROTEGIDO.
 *
 * `rotuloDoContato` cai para o telefone de propósito quando não há nome — é
 * isso que faz um contato do WhatsApp sem nome aparecer como algo, e não como
 * "Sem nome". Mas essa queda não sabe nada de proteção de contato.
 *
 * A rota IRMÃ, `GET /api/v1/ai/followups/queue`, já tratava disso desde a
 * revisão final do módulo (achado I1). Esta, a de detalhe, ficou de fora: um
 * corretor `viewer`/`agent` abria o dossiê de um follow-up de lead que NÃO
 * cadastrou e lia o número no campo `contact.name` — a mesma informação que
 * `GET /api/v1/contacts` nula na resposta.
 *
 * ⚠️ ISTO É ANTERIOR À FUSÃO DE 2026-09-07, e não dano dela. Foi encontrado ao
 * varrer as superfícies que devolvem contato depois de sincronizar com a
 * v1.16.1.
 *
 * O que o teste prende, e por que nesta forma: o campo que vaza é `contact.name`
 * — não existe um `phone_number` na resposta para conferir. Então a asserção é
 * sobre o RÓTULO: para quem não pode ver, ele degrada para "Sem nome"; para
 * quem pode, ele traz o número formatado. Medir os dois lados é o que separa
 * "protegeu" de "quebrou o rótulo para todo mundo".
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const CRIADOR = "11111111-1111-4111-8111-111111111111";
const OUTRO = "99999999-9999-4999-8999-999999999999";
const ENROLLMENT = "44444444-4444-4444-8444-444444444444";

/** Contato SEM nome nenhum: só o telefone identifica — o pior caso do rótulo. */
const CONTATO_SO_TELEFONE = {
  id: "contact-1",
  name: null,
  display_name: null,
  phone_number: "+5531988887777",
  created_by_user_id: CRIADOR,
};

function supabaseComEnrollment() {
  const enrollment = {
    id: ENROLLMENT,
    status: "active",
    contact_id: "contact-1",
    pointer_id: "ptr-1",
    version_id: "ver-1",
    current_node_id: "no-1",
    next_eval_at: null,
    claimed_until: null,
    started_at: null,
    completed_at: null,
    updated_at: null,
    outcome: null,
    cancel_reason: null,
    last_error: null,
    attempts: 0,
    max_attempts: 3,
    steps_taken: 0,
    timing_plan: null,
    contacts: CONTATO_SO_TELEFONE,
    followup_flow_pointers: { name: "Fluxo" },
    ai_agents: { name: "Agente" },
    followup_flow_versions: { graph: null },
  };
  return {
    from(tabela: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "order"]) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve({ data: enrollment, error: null });
      // `followup_enrollment_events` e `resolveAutores` — nada a devolver.
      b.limit = () => Promise.resolve({ data: [], error: null });
      if (tabela === "followup_enrollments") return b;
      return b;
    },
  };
}

async function nomeDoContatoVistoPor(userId: string, role: string): Promise<string> {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: userId, idioma: "pt-BR" } as never,
    org: { orgId: ORG, name: "Org", role },
  } as never);
  vi.mocked(createClient).mockResolvedValue(supabaseComEnrollment() as never);

  const { GET } = await import("./../../app/api/v1/ai/followups/enrollments/[id]/route");
  const res = await GET({} as never, { params: Promise.resolve({ id: ENROLLMENT }) } as never);
  const body = (await res.json()) as { data: { contact: { name: string } } };
  return body.data.contact.name;
}

describe("GET /api/v1/ai/followups/enrollments/[id] — o rótulo não vaza telefone protegido", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockReset();
    vi.mocked(createClient).mockReset();
  });

  it("agent que NÃO cadastrou o contato não recebe o telefone no rótulo", async () => {
    const nome = await nomeDoContatoVistoPor(OUTRO, "agent");
    expect(nome).not.toContain("988887777");
    expect(nome).not.toContain("31988887777");
    expect(nome).toBe("Sem nome");
  });

  it("agent que cadastrou o contato continua vendo o telefone como rótulo", async () => {
    const nome = await nomeDoContatoVistoPor(CRIADOR, "agent");
    expect(nome).toContain("988887777");
  });

  it("manager vê o telefone de qualquer contato", async () => {
    const nome = await nomeDoContatoVistoPor(OUTRO, "manager");
    expect(nome).toContain("988887777");
  });
});
