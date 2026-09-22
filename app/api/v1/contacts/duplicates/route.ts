/**
 * GET /api/v1/contacts/duplicates — quem é a MESMA pessoa cadastrada duas vezes.
 *
 * A detecção é PURA (`lib/contacts/duplicados.ts`) e roda aqui, no servidor,
 * sobre a página de contatos vivos que a RLS deixa o usuário ver. Não é um
 * `select` esperto: os três índices únicos parciais de `contacts` já impedem
 * duas linhas ativas com a MESMA string, então o que sobra para o produto é a
 * grafia diferente do mesmo número (o nono dígito) e o telefone que a ingestão
 * do WhatsApp parkou em `source_metadata.telefone_em_conflito`. Nenhum dos dois
 * é comparação de igualdade, e é por isso que a regra vive em TypeScript
 * testável em vez de virar SQL que ninguém relê.
 *
 * ⚠️ DIVERGÊNCIA DESTE FORK: o gate é `manager`, e não `viewer` como no upstream.
 *
 * O upstream libera a listagem para `viewer` com o argumento de que é "leitura
 * de contato, que ele já enxerga na tabela". Nesta instalação isso não vale: a
 * proteção de contato (`lib/contacts/visibility.ts`) esconde telefone e e-mail
 * do corretor que NÃO cadastrou o lead, justamente para ele não conseguir levar
 * o cliente para fora. Esta rota devolvia os dois em texto puro para qualquer
 * membro da organização.
 *
 * E mascarar contato a contato não resolveria: `chave` É o telefone (ou o
 * e-mail) normalizado — `chaveDeTelefone`/`chaveDeEmail` —, então o dado
 * protegido sairia pelo agrupamento mesmo com os campos nulados. Sobraria
 * redigir também a chave, e aí a resposta não diz mais nada a ninguém.
 *
 * `manager` é o mesmo papel que `POST /contacts/merge` exige. Ou seja: quem
 * perde a tela é exatamente quem não podia fundir nada com ela — a leitura
 * passa a ter o alcance de quem age, que é o que ela sempre deveria ter tido.
 * Ver docs/superpowers/specs/2026-08-09-protecao-contato-corretor-design.md.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  encontrarContatosDuplicados,
  principalSugerido,
  type ContatoParaDeduplicar,
} from "@/lib/contacts/duplicados";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Teto de linhas varridas.
 *
 * A varredura é O(n) e roda sobre contatos VIVOS — mas ela é uma tela de
 * limpeza, não um relatório: numa base grande, devolver "os 5.000 grupos" não
 * ajuda ninguém a decidir nada e custa memória do contêiner do self-hoster.
 * Quem passa daqui limpa em levas, e a resposta diz que truncou (`varreu_tudo`)
 * em vez de calar — silêncio aqui leria como "não há mais duplicata".
 */
const TETO_DE_VARREDURA = 2000;

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "contact" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  // Cliente da SESSÃO. Esta leitura chegou a ser feita pelo servidor, quando a
  // barreira de contato no banco existia (`revoke select` em `phone_number` e
  // `email` para o papel `authenticated`): sem privilégio, a consulta morria. A
  // barreira foi retirada e virou dívida medida — ver a seção dela em
  // `docs/fork/pontos-de-contato.md` e o sentinela
  // `tests/invariants/contato-protegido-no-banco.test.ts` —, e sem ela o cliente
  // privilegiado não protegia nada: era só mais um ponto de contato com o
  // upstream. Quem guarda a rota é o gate `manager` acima.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id, name, display_name, email, email_normalized, phone_number, is_merged_into, is_anonymized, source_metadata, created_at, last_activity_at",
    )
    .eq("organization_id", org.orgId)
    .is("is_merged_into", null)
    .eq("is_anonymized", false)
    .order("created_at", { ascending: true })
    .limit(TETO_DE_VARREDURA + 1);
  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  const linhas = (data ?? []) as unknown as ContatoParaDeduplicar[];
  const varreuTudo = linhas.length <= TETO_DE_VARREDURA;
  const grupos = encontrarContatosDuplicados(linhas.slice(0, TETO_DE_VARREDURA));

  return ok(
    grupos.map((grupo) => ({
      chave: grupo.chave,
      motivos: grupo.motivos,
      principal_sugerido: principalSugerido(grupo),
      contatos: grupo.contatos.map((c) => ({
        id: c.id,
        name: c.name,
        display_name: c.display_name,
        email: c.email,
        phone_number: c.phone_number,
        created_at: c.created_at,
        last_activity_at: c.last_activity_at,
      })),
    })),
    { requestId, meta: { varreu_tudo: varreuTudo, contatos_varridos: Math.min(linhas.length, TETO_DE_VARREDURA) } },
  );
}
