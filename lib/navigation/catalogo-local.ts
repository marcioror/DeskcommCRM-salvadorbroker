/**
 * DESTINOS DESTA CASA (Salvador Broker), fora do catálogo do upstream.
 *
 * O catálogo do produto (`catalogo.ts`) é dele e continua sendo dele: o único
 * ponto em que este arquivo encosta lá é o spread no fim daquele array. Foi
 * medido antes de escolher assim — `lib/navigation/` recebeu 66 commits do
 * upstream entre 2026-09-06 e 2026-09-21, e enquanto o destino de Imóveis
 * morava no meio da lista dele, toda sincronização conflitava aqui.
 *
 * ⚠️ SEM `sidebar`, e a razão não é a qualidade da tela. O menu lateral está no
 * limite medido: `tests/e2e/navegacao.spec.ts` exige que em 900px ele caiba sem
 * rolagem, e o próprio catálogo do upstream já deixou Prospecção de fora pelo
 * mesmo motivo, com o número escrito lá ("com ela, seriam 20 portas"). Imóveis
 * entra pela mesma porta de Prospecção: o hub do grupo CRM ("Ver tudo em CRM")
 * e o ⌘K.
 *
 * O `modulo?: ModuloOpcional` que a #1290 trouxe (v1.45.0) NÃO encerra esta
 * exceção, e isso foi conferido na sincronização da v1.51.0 (26/09/2026): ele
 * ESCONDE a porta quando o módulo está desligado, não dá vaga no menu. Num
 * grupo com hub, como CRM, só `sidebar: true` põe o item no menu lateral
 * (`sidebarGroups`, em `registry.ts`), e o limite de 900px continua valendo.
 * Usar o campo exigiria acrescentar "imoveis" a `MODULOS_OPCIONAIS`, que é
 * arquivo do upstream: um ponto de contato novo sem ganho nenhum.
 */
import type { NavMetadata } from "./catalogo";

export const NAV_CATALOG_LOCAL = [
  {
    href: "/app/properties",
    label: "Imóveis",
    description: "Catálogo de imóveis para venda e locação, vinculados aos leads interessados.",
    icon: "Buildings",
    group: "crm",
    section: "O dia a dia da venda",
  },
] as const satisfies readonly NavMetadata[];
