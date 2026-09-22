import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_CONTACT_1, seedGov, sql } from "./gov-helpers";

/**
 * A DÍVIDA MEDIDA: A PROTEÇÃO DE CONTATO VALE NA ROTA, NÃO NO BANCO.
 *
 * `lib/contacts/visibility.ts` nula telefone e e-mail antes de a API responder,
 * e todo handler a chama. Isso protege quem entra pela API do Next, e só ela.
 *
 * Por baixo, o baseline dá `GRANT ALL ON TABLE public.contacts TO authenticated`
 * e a única regra da tabela isola por organização. Postgres não filtra coluna por
 * RLS: quem lê a linha lê o telefone junto. Como a Data API do Supabase responde
 * na internet e o login por senha aceita a anon key — que é pública por
 * construção e já vai no bundle —, um atendente com as PRÓPRIAS credenciais
 * obtém um token legítimo fora do app e alcança a carteira inteira por um
 * caminho que a `protegerContato` não cobre.
 *
 * ── POR QUE ISTO É UM TESTE DE ESTADO, E NÃO UMA BARREIRA ───────────────────
 *
 * A barreira foi escrita e medida em 21/09/2026: `revoke select` na tabela e
 * `grant select` coluna a coluna, derivado do catálogo. Ela FUNCIONA, e colide
 * com o produto em dois lugares que o CI mostrou, um de cada natureza:
 *
 *   1. dez funções do banco leem `public.contacts` SEM `security definer`, isto
 *      é, com o privilégio de quem as chama. `fn_activity_report` é a mais
 *      visível: devolve `contact_phone` e é chamada pelo papel do usuário. Com a
 *      coluna revogada, o relatório inteiro morre em "permission denied";
 *   2. os invariantes de isolamento do próprio produto leem `contacts` e
 *      `contact_field_proposals` COMO USUÁRIO para provar o recorte por
 *      organização. Não são testes frouxos: são o produto declarando que o papel
 *      `authenticated` lê aquelas tabelas.
 *
 * Fechar isso é conserto do PRODUTO, não divergência de um fork: ou as funções
 * viram `security definer` com recorte próprio, ou o dado sensível sai da tabela
 * para um lugar com ACL própria. Carregar a barreira só aqui significaria brigar
 * com cada função nova do upstream, para sempre, que é o oposto do que
 * `docs/fork/pontos-de-contato.md` existe para evitar.
 *
 * ⚠️ ESTE TESTE É O SENTINELA DA DÍVIDA. Ele afirma o estado de HOJE. No dia em
 * que o upstream fechar a porta, ele fica VERMELHO, e é esse vermelho que avisa
 * que dá para apagar este arquivo e parar de depender só da rota.
 */
describe("proteção de contato: onde a barreira está, e onde ela não está", () => {
  beforeAll(() => {
    seedGov();
  });

  function comoUsuario(userId: string, consulta: string): { ok: boolean; erro: string } {
    try {
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
        ${consulta}
      `);
      return { ok: true, erro: "" };
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      return { ok: false, erro: stderr };
    }
  }

  it("o atendente lê o contato da própria organização (controle positivo)", () => {
    const r = comoUsuario(
      GOV_AGENT_A,
      `select id from public.contacts where id = '${GOV_CONTACT_1}'::uuid;`,
    );
    expect(r.ok, "o atendente precisa enxergar o contato para atender").toBe(true);
  });

  it("HOJE o telefone é legível direto na tabela, e é isso que a rota compensa", () => {
    const r = comoUsuario(
      GOV_AGENT_A,
      `select phone_number from public.contacts where id = '${GOV_CONTACT_1}'::uuid;`,
    );
    expect(
      r.ok,
      [
        "A leitura direta de `contacts.phone_number` por um papel `agent` foi RECUSADA.",
        "",
        "Se isso passou a acontecer porque o upstream fechou a porta (coluna revogada, dado",
        "sensível movido para tabela com ACL própria, ou funções viradas `security definer`),",
        "então é boa notícia: apague este arquivo, tire a dívida de",
        "`docs/fork/pontos-de-contato.md` e diga no PR qual mudança fechou.",
        "",
        "Se foi alguém reintroduzindo o `revoke` local, leia o cabeçalho deste arquivo antes:",
        "ele custa dez funções do produto e os invariantes de isolamento do próprio upstream.",
      ].join("\n"),
    ).toBe(true);
  });

  it("e o e-mail também, pela mesma razão", () => {
    const r = comoUsuario(
      GOV_AGENT_A,
      `select email from public.contacts where id = '${GOV_CONTACT_1}'::uuid;`,
    );
    expect(r.ok, "mesma dívida do telefone; ver o caso acima").toBe(true);
  });
});
