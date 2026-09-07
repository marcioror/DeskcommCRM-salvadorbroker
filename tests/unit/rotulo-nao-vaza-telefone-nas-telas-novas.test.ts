import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { montarRelatorio, type RelatorioBruto } from "@/lib/reports/atividades";

/**
 * DUAS SUPERFÍCIES QUE CHEGARAM COM A v1.16 E CAÍAM PARA O TELEFONE.
 *
 * `rotuloDoContato` cai para o telefone quando o contato não tem nome — de
 * propósito, e é o que faz um contato do WhatsApp aparecer como algo em vez de
 * "Sem nome". Mas essa queda não sabe nada da proteção de contato deste fork, e
 * cada tela nova que a chama vira uma porta lateral para o número.
 *
 * Foram encontradas ao varrer os chamadores de `rotuloDoContato` depois da
 * sincronização com a v1.16.1 — a mesma varredura que achou o dossiê de
 * follow-up (`followup-detalhe-protege-telefone.test.ts`).
 */

const BASE: RelatorioBruto = {
  total: 1,
  by_actor: [],
  by_type: [],
  daily: [],
  items_truncated: false,
  items: [
    {
      id: "atv-1",
      type: "message_sent",
      performed_at: "2026-09-07T12:00:00.000Z",
      actor_kind: "user",
      user_id: "u-1",
      agent_id: null,
      reason: null,
      lead_id: null,
      lead_title: null,
      contact_id: "contact-1",
      // Contato SÓ com telefone: o pior caso do rótulo.
      contact_display_name: null,
      contact_name: null,
      contact_phone: "+5531988887777",
    },
  ],
};

const CTX = { nomes: { usuarios: {}, agentes: {} }, vocabulary: null };

describe("relatório de atividades — o rótulo do contato não vaza telefone", () => {
  it("quem NÃO pode ver contato sensível recebe 'Sem nome', nunca o número", () => {
    const r = montarRelatorio(BASE, { ...CTX, podeVerContatoSensivel: false });
    const nome = r.atividades[0]!.contatoNome;
    expect(nome).not.toContain("988887777");
    expect(nome).toBe("Sem nome");
  });

  it("quem pode ver continua vendo o telefone — o corte não cega a tela inteira", () => {
    const r = montarRelatorio(BASE, { ...CTX, podeVerContatoSensivel: true });
    expect(r.atividades[0]!.contatoNome).toContain("988887777");
  });

  it("linha sem contato nenhum continua devolvendo null, nos dois casos", () => {
    // A regra antiga (não inventar rótulo para linha sem contato) tem que
    // sobreviver ao corte novo — senão "Sem nome" passaria a afirmar que existe
    // alguém ali, que é o defeito que o comentário original previne.
    const semContato: RelatorioBruto = {
      ...BASE,
      items: [{ ...BASE.items[0]!, contact_id: null }],
    };
    for (const pode of [true, false]) {
      const r = montarRelatorio(semContato, { ...CTX, podeVerContatoSensivel: pode });
      expect(r.atividades[0]!.contatoNome).toBeNull();
    }
  });
});

describe("notificação push — o telefone nunca chega à tela de bloqueio", () => {
  /**
   * Prova ESTRUTURAL, e não por comportamento, e a razão é o formato do canal:
   * `enviarPushDaOrg` manda UM payload para TODAS as inscrições da organização.
   * Não existe espectador para o qual mascarar — então a única regra correta é
   * "o telefone não entra no payload", e ela se mede no código, onde mora.
   *
   * Um teste de comportamento aqui provaria um caso; este proíbe a categoria,
   * incluindo o `rotuloDoContato` que alguém reintroduziria numa fusão futura
   * sem perceber o que o canal tem de diferente.
   */
  it("push.handler não usa a cadeia que cai para o telefone", () => {
    const fonte = readFileSync(
      join(process.cwd(), "lib/notifications/push.handler.ts"),
      "utf8",
    );
    // Só o USO. A prosa acima explica por que a função existe e cita o nome
    // dela — casar solto reprovaria o arquivo por ele falar de si mesmo, que é
    // a mesma armadilha documentada em `varredura-anon-e-o-ultimo-bloco`.
    expect(fonte).not.toMatch(/rotuloDoContato\s*\(/);
    expect(fonte).toMatch(/nomeCadastradoDoContato\s*\(/);
  });
});
