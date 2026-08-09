import { describe, expect, it } from "vitest";

import { garantirLeadDaConversa } from "@/lib/leads/nascimento-do-lead";

/**
 * ACHADO I2 (revisão final da proteção de contato) — `crm_leads.title` NUNCA
 * pode carregar um telefone.
 *
 * `rotuloDoContato` cai para o telefone quando o contato não tem nome usável —
 * decisão certa para EXIBIÇÃO (`lib/contacts/rotulo-do-contato.ts`). O ponto de
 * nascimento do lead (`lib/leads/nascimento-do-lead.ts`) usava essa mesma
 * função para preencher `title`, uma coluna de texto plano que
 * `app/api/v1/leads/route.ts` devolve a QUALQUER viewer — inclusive quem não
 * pode ver o telefone deste contato. Uma vez gravado ali, a máscara per-viewer
 * do endpoint de contatos não alcança mais o dado: ele já vazou por outra
 * porta.
 *
 * Este arquivo é unitário (sem Postgres) e testa só a REGRA de título — o
 * caminho completo (funil, etapa, atividade) já é coberto pelo invariante
 * `tests/invariants/nascimento-do-lead.test.ts`, que roda contra o schema
 * real. O duble abaixo simula só o suficiente da cadeia do Supabase para o
 * card nascer.
 */

interface ContatoDuble {
  is_blocked?: boolean;
  display_name?: string | null;
  name?: string | null;
  phone_number?: string | null;
}

function clientDuble(contato: ContatoDuble | null) {
  const inserts: Array<{ tabela: string; valores: Record<string, unknown> }> = [];

  function contactsChain() {
    const q: Record<string, unknown> = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      maybeSingle() {
        return Promise.resolve({ data: contato, error: null });
      },
    };
    return q;
  }

  function crmLeadsChain() {
    // Duas formas de uso na mesma tabela: verificação de lead já aberto
    // (select…maybeSingle) e a criação (insert…select…single).
    const buscaExistente: Record<string, unknown> = {
      eq() {
        return buscaExistente;
      },
      limit() {
        return buscaExistente;
      },
      maybeSingle() {
        // Nenhum lead aberto ainda — o caminho sob teste é sempre criação.
        return Promise.resolve({ data: null, error: null });
      },
    };
    return {
      select() {
        return buscaExistente;
      },
      insert(valores: Record<string, unknown>) {
        inserts.push({ tabela: "crm_leads", valores });
        return {
          select() {
            return {
              single() {
                return Promise.resolve({ data: { id: "lead-novo" }, error: null });
              },
            };
          },
        };
      },
    };
  }

  function pipelineOuEtapaChain() {
    const q: Record<string, unknown> = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      maybeSingle() {
        return Promise.resolve({ data: { id: "id-1" }, error: null });
      },
    };
    return q;
  }

  const client = {
    from(tabela: string) {
      switch (tabela) {
        case "contacts":
          return contactsChain();
        case "crm_leads":
          return crmLeadsChain();
        case "crm_pipelines":
        case "crm_stages":
          return pipelineOuEtapaChain();
        case "crm_lead_activities":
          // Fire-and-forget: só precisa resolver, o teste não olha a timeline.
          return { insert: () => Promise.resolve({ error: null }) };
        default:
          throw new Error(`tabela não mapeada no duble de nascimento-do-lead: ${tabela}`);
      }
    },
  };

  return { client, inserts };
}

const ORG = "a1111111-1111-4111-8111-111111111111";
const CONTATO = "a2222222-2222-4222-8222-222222222222";
const CONVERSA = "a3333333-3333-4333-8333-333333333333";

function tituloGravado(inserts: Array<{ tabela: string; valores: Record<string, unknown> }>): unknown {
  return inserts.find((i) => i.tabela === "crm_leads")?.valores.title;
}

describe("nascimento do lead — título nunca é telefone (I2)", () => {
  it("contato sem nome, só telefone: título NÃO é o número", async () => {
    const { client, inserts } = clientDuble({
      is_blocked: false,
      display_name: null,
      name: null,
      phone_number: "+5531988887777",
    });

    const r = await garantirLeadDaConversa(client as never, {
      organizationId: ORG,
      contactId: CONTATO,
      conversationId: CONVERSA,
      nomeDoContato: null, // mensagem também sem nome — o payload não socorre
    });

    expect(r.criado, `esperava criar, veio ${JSON.stringify(r)}`).toBe(true);
    const titulo = tituloGravado(inserts);
    // A asserção que morde: contra o código antigo, `title` seria
    // "+5531988887777" — o telefone copiado para uma coluna que a API devolve
    // a qualquer viewer, driblando a máscara per-viewer do endpoint de
    // contatos.
    expect(titulo).not.toBe("+5531988887777");
    expect(titulo).toBe("Novo contato pelo WhatsApp");
  });

  it("contato COM nome cadastrado: título continua o nome real", async () => {
    const { client, inserts } = clientDuble({
      is_blocked: false,
      display_name: "Maria Souza",
      name: null,
      phone_number: "+5531988887777",
    });

    const r = await garantirLeadDaConversa(client as never, {
      organizationId: ORG,
      contactId: CONTATO,
      conversationId: CONVERSA,
      nomeDoContato: null,
    });

    expect(r.criado, `esperava criar, veio ${JSON.stringify(r)}`).toBe(true);
    expect(tituloGravado(inserts)).toBe("Maria Souza");
  });
});
