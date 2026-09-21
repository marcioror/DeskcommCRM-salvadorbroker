import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_AGENT_A, GOV_CONTACT_1, countAs, seedGov, sql } from "./gov-helpers";

/**
 * A PROTEÇÃO DE CONTATO TEM DE VALER TAMBÉM PARA QUEM NÃO PASSA PELA ROTA.
 *
 * `lib/contacts/visibility.ts` nula telefone e e-mail antes de a API responder,
 * e todo handler a chama. Isso protege quem entra pela API do Next, e só.
 *
 * Por baixo, o baseline dá `GRANT ALL ON TABLE public.contacts TO authenticated`
 * e a única regra da tabela isola por organização. Postgres não filtra coluna
 * por RLS: quem lê a linha lê o telefone junto. Como a Data API do Supabase
 * responde na internet e o login por senha aceita a anon key (que é pública por
 * construção e já vai no bundle), um corretor com as PRÓPRIAS credenciais
 * obtinha um JWT legítimo fora do app e lia a carteira inteira com
 * `select=phone_number` — exatamente o que a proteção existe para impedir,
 * passando por fora dela.
 *
 * `supabase/local/contato-protegido.sql` fecha isso no banco. Este arquivo é o
 * que prova, e cada caso vem em PAR: um controle positivo mostrando que o
 * caminho legítimo continua aberto, e o caso que mede a barreira. Sem o
 * controle, um teste destes fica verde por engano no dia em que a tabela
 * simplesmente sumir.
 */
describe("proteção de contato: a barreira existe no banco, não só na rota", () => {
  beforeAll(() => {
    seedGov();
  });

  /** Executa como o papel `authenticated`, com as claims do usuário. */
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

  it("controle positivo: o corretor continua lendo o contato (nome, id, organização)", () => {
    const linhas = countAs(
      GOV_AGENT_A,
      `select count(*) from public.contacts where id = '${GOV_CONTACT_1}'::uuid;`,
    );
    expect(
      linhas,
      "o corretor precisa continuar enxergando o contato para atender; se isto zerou, a barreira " +
        "fechou demais e derrubou o produto junto",
    ).toBe(1);
  });

  it("o corretor NÃO lê phone_number direto na tabela", () => {
    const r = comoUsuario(
      GOV_AGENT_A,
      `select phone_number from public.contacts where id = '${GOV_CONTACT_1}'::uuid;`,
    );
    expect(
      r.ok,
      "um corretor autenticado leu `contacts.phone_number` direto pelo banco. É o caminho que a " +
        "`protegerContato` não cobre: JWT legítimo + Data API, sem passar pela rota. Confira se " +
        "`supabase/local/contato-protegido.sql` foi aplicado depois do baseline.",
    ).toBe(false);
    expect(r.erro).toMatch(/permission denied|permissão negada/i);
  });

  it("o corretor NÃO lê e-mail, nem pela coluna normalizada", () => {
    for (const coluna of ["email", "email_normalized"]) {
      const r = comoUsuario(
        GOV_AGENT_A,
        `select ${coluna} from public.contacts where id = '${GOV_CONTACT_1}'::uuid;`,
      );
      expect(r.ok, `o corretor leu \`contacts.${coluna}\` direto no banco`).toBe(false);
    }
  });

  it("o corretor NÃO contorna pela escrita (update … returning)", () => {
    const r = comoUsuario(
      GOV_AGENT_A,
      `update public.contacts set name = name where id = '${GOV_CONTACT_1}'::uuid returning phone_number;`,
    );
    expect(
      r.ok,
      "`update … returning phone_number` leu a coluna pelo caminho da escrita. Barreira de leitura " +
        "sem revogar a escrita é contornável numa linha — é por isso que o `revoke all` vem antes " +
        "do `grant select (colunas)`.",
    ).toBe(false);
  });

  it("nem o admin da organização lê pela tabela: quem decide é o servidor", () => {
    const r = comoUsuario(
      GOV_ADMIN,
      `select phone_number from public.contacts where id = '${GOV_CONTACT_1}'::uuid;`,
    );
    expect(
      r.ok,
      "gerente e admin PODEM ver o telefone, e é a rota que entrega, com service role e depois de " +
        "`podeVerContatoSensivel`. Dar a coluna ao papel `authenticated` para atender o admin " +
        "reabriria o buraco para todo corretor, porque o papel do banco é o mesmo para os dois.",
    ).toBe(false);
  });

  it("o servidor (service_role) continua lendo tudo, senão o produto para", () => {
    const valor = sql(`
      set role service_role;
      select coalesce(phone_number, '(nulo)') from public.contacts where id = '${GOV_CONTACT_1}'::uuid;
    `);
    expect(
      valor.length,
      "service_role perdeu a leitura de `phone_number`: os handlers que entregam contato ao usuário " +
        "falam com o banco por aqui, e sem isso a proteção deixaria de ter o que proteger.",
    ).toBeGreaterThan(0);
  });

  it("a fila de sugestões da IA não devolve o dado pela janela", () => {
    const r = comoUsuario(GOV_AGENT_A, `select 1 from public.contact_field_proposals limit 1;`);
    expect(
      r.ok,
      "`contact_field_proposals` guarda telefone e e-mail PROPOSTOS num campo genérico, então não dá " +
        "para recortar coluna: o papel perde a leitura direta, e quem serve essa fila é a rota, que " +
        "já filtra por `filtrarPropostasVisiveis`.",
    ).toBe(false);
  });
});
