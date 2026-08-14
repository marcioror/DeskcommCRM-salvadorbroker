import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_ORG,
  GOV_VIEWER,
  countAs,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * Migration 9004 — a policy de imóveis exigia ORGANIZAÇÃO e não PAPEL.
 *
 * `properties`/`properties_media` nasceram (9001) com a forma org-flat que era o
 * padrão do repo: uma policy `for all` cujo único predicado é
 * `organization_id in (select * from fn_user_org_ids())`. A API sempre foi três
 * níveis mais estrita — `requireRole("viewer")` para ler, `requireRole("agent")`
 * para POST/PATCH/DELETE, inclusive na rota de mídia.
 *
 * Rota não é fronteira: a URL do PostgREST e a `anon key` vão para o browser por
 * construção, e o `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
 * authenticated` do baseline alcança toda tabela criada depois dele. Um membro
 * `viewer`, com o próprio JWT, escrevia no cadastro de imóveis sem passar por
 * rota nenhuma — e o DELETE dele seria real, enquanto o da API é soft.
 *
 * ## Cada caso vem em PAR
 *
 * Papel de baixo barrado E papel de cima passando. Só a metade negativa ficaria
 * verde se a tabela sumisse, se a policy negasse todo mundo, ou se a fixture não
 * existisse — os três modos de falha que fazem um gate de segurança mentir.
 *
 * O par de LEITURA é o que impede o conserto de virar dano: a API deixa `viewer`
 * LER imóvel, e uma policy que só olhasse papel de escrita tiraria a listagem da
 * tela de quem tem direito a ela.
 */

const IMOVEL = "ffff0000-1111-4000-8000-000000000001";
const IMOVEL_ALVO = "ffff0000-1111-4000-8000-000000000002";

function seedImoveis(): void {
  sql(`
    insert into public.properties (id, organization_id, title, property_type, purpose)
      values ('${IMOVEL}', '${GOV_ORG}', 'Apartamento da fixture', 'apartment', 'sale')
      on conflict (id) do nothing;
    insert into public.properties (id, organization_id, title, property_type, purpose)
      values ('${IMOVEL_ALVO}', '${GOV_ORG}', 'Casa que o viewer tentará apagar', 'house', 'rent')
      on conflict (id) do nothing;
  `);
}

beforeAll(() => {
  seedGov();
  seedImoveis();
});

describe("9004 — escrita em imóveis exige papel de corretor (agent+)", () => {
  it("viewer NÃO cria imóvel", () => {
    expect(
      writeCountAs(
        GOV_VIEWER,
        `insert into public.properties (organization_id, title, property_type, purpose)
           values ('${GOV_ORG}', 'Imóvel fantasma do viewer', 'land', 'sale')`,
      ),
    ).toBe(0);
  });

  it("agent CRIA imóvel — o corretor cadastrar é o trabalho dele", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.properties (organization_id, title, property_type, purpose)
           values ('${GOV_ORG}', 'Imóvel legítimo do corretor', 'land', 'sale')`,
      ),
    ).toBe(1);
  });

  it("viewer NÃO reescreve o preço", () => {
    expect(
      writeCountAs(
        GOV_VIEWER,
        `update public.properties set price_sale_cents = 1 where id = '${IMOVEL}'`,
      ),
    ).toBe(0);
  });

  it("agent reescreve o preço", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `update public.properties set price_sale_cents = 45000000 where id = '${IMOVEL}'`,
      ),
    ).toBe(1);
  });

  it("viewer NÃO apaga imóvel — e pelo PostgREST o DELETE seria real, não soft", () => {
    expect(
      writeCountAs(GOV_VIEWER, `delete from public.properties where id = '${IMOVEL_ALVO}'`),
    ).toBe(0);
  });

  it("admin apaga imóvel", () => {
    expect(
      writeCountAs(GOV_ADMIN, `delete from public.properties where id = '${IMOVEL_ALVO}'`),
    ).toBe(1);
  });

  it("viewer NÃO escreve em properties_media", () => {
    expect(
      writeCountAs(
        GOV_VIEWER,
        `insert into public.properties_media (organization_id, property_id, storage_path)
           values ('${GOV_ORG}', '${IMOVEL}', 'property-media/fantasma.jpg')`,
      ),
    ).toBe(0);
  });

  it("agent escreve em properties_media", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.properties_media (organization_id, property_id, storage_path)
           values ('${GOV_ORG}', '${IMOVEL}', 'property-media/legitima.jpg')`,
      ),
    ).toBe(1);
  });

  /**
   * CONTROLE POSITIVO DA LEITURA. Sem ele, uma policy que negasse tudo deixaria
   * os seis casos acima verdes — e teria quebrado a tela de imóveis para o papel
   * que a API autoriza a vê-la (`requireRole("viewer")` no GET).
   */
  it("CONTROLE: viewer continua LENDO imóvel — a API autoriza, a policy não pode tirar", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.properties where id = '${IMOVEL}'`)).toBe(
      1,
    );
  });

  it("CONTROLE: viewer continua LENDO properties_media", () => {
    expect(
      countAs(
        GOV_VIEWER,
        `select count(*) from public.properties_media where property_id = '${IMOVEL}'`,
      ),
    ).toBeGreaterThanOrEqual(1);
  });
});
