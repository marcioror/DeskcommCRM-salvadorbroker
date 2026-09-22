# Onde este fork encosta no upstream

Este documento existe para uma pergunta só, feita no meio de uma sincronização
com o `melgarafael/DeskcommCRM`: **o que eu preciso conferir antes de dar a
fusão por boa?**

A resposta curta está na tabela abaixo. A resposta que não envelhece é
`tests/unit/pontos-de-contato-do-fork.test.ts`: ele reprova, com instrução no
texto da falha, quando qualquer linha desta tabela some. Se este documento e o
teste discordarem, **o teste está certo** e o documento é que ficou velho.

## Por que isto é perigoso e merece um alarme

Quase tudo o que este fork acrescenta é arquivo novo, e arquivo novo não
conflita com ninguém: o módulo de imóveis são 45 arquivos que só existem aqui, e
nenhum deles colide de nome com nada do upstream.

O risco mora nas poucas linhas que vivem **dentro** de arquivo dele. Elas não
somem com conflito, que seria o caso fácil. Somem em silêncio, quando o lado de
lá reescreve o arquivo inteiro e o git aceita a versão nova sem ter o que
perguntar. O sintoma aparece longe da causa: a tela de Imóveis responde por URL
mas não está no menu, o e2e reprova por tabela ausente, a VPS puxa a imagem do
namespace errado. A fusão que causou já está a dez commits de distância.

## Os pontos de contato

| Onde | O que é nosso ali | Se sumir |
|---|---|---|
| `lib/navigation/catalogo.ts` | o import de `catalogo-local` e o spread `[...NAV_CATALOG_BASE, ...NAV_CATALOG_LOCAL]` | Imóveis some da navegação inteira, inclusive do ⌘K, e a tela continua respondendo por URL |
| `components/kanban/LeadDossier.tsx` | import e `<LeadInterestedProperties leadId={lead.id} />` | o vínculo lead↔imóvel continua no banco e some da tela |
| `lib/schemas/index.ts` | `export * from "./properties";` | o build da imagem quebra em `propertyCreateSchema doesn't exist` (o typecheck passa, quem reclama é o bundler) |
| `scripts/test-db.sh` | o `source` de `scripts/local-no-molde.sh` e a chamada de `aplicar_sql_local_no_molde` dentro de `aplicar_baseline()` | os invariantes do módulo reprovam por tabela ausente |
| `.github/workflows/e2e.yml` | o passo `Aplicar o supabase/local` | o e2e do módulo reprova por tabela ausente |
| `.github/workflows/e2e.yml` | `properties.spec.ts` na lista da parte 1 | a spec deixa de rodar; quem pega é o `e2e-cobertura-completa`, apontando para a lista e não para a fusão |
| `hostgator-setup-kit/_common.sh` | `IMG_NS="ghcr.io/marcioror"` | a VPS passa a puxar a imagem do upstream: sobe igual, sem imóveis e sem proteção de contato, e o log não diz nada |
| `hostgator-setup-kit/_common.sh` | a função `aplicar_sql_local` | install e update deixam de criar ou atualizar as tabelas desta casa |
| `hostgator-setup-kit/install.sh` | duas chamadas de `aplicar_sql_local` (banco novo e schema existente) | instalação nova nasce sem o módulo |
| `hostgator-setup-kit/update.sh` | uma chamada de `aplicar_sql_local` | versão nova do módulo nunca alcança quem já tem instalação de pé |
| `lib/audit/actions.ts` | os sete verbos `property.*` | o typecheck reprova em sete rotas de uma vez, com `TS2322` |
| `lib/leads/activity-vocabulary.ts` | `property_linked` e `property_unlinked`, no tipo e nos rótulos | a timeline do lead mostra texto genérico no vínculo de imóvel, e o typecheck reprova na rota |
| `.github/workflows/release.yml` | o job `ha-app-de-release` e a condição nos dois jobs seguintes | todo merge na main manda e-mail de falha, para sempre |
| `tests/unit/gatilho-dos-jobs-de-entrega.test.ts` | as três entradas com a condição de release do fork | o `verify` reprova acusando mudança de gatilho |

Fora da tabela, e por isso sem alarme, ficam os arquivos que este fork
**possui** por inteiro: o `hostgator-setup-kit/`, o `docker-compose.prod.yml`, o
`Caddyfile`, o `docker/scheduler/entrypoint.sh` e os `.env*.example`. Ali a
divergência é o estado normal, e uma fusão que os reescreva aparece como
conflito de verdade, que ninguém deixa passar sem ver.

## As duas regras que evitam ponto de contato novo

**O schema desta casa não entra no `supabase/baseline.sql`.** Ele mora em
`supabase/local/*.sql` e é aplicado logo depois do baseline, pelo `install.sh`,
pelo `update.sh` e pelos dois rigs de teste. O número que decidiu isso: entre
06/09/2026 e 21/09/2026 o upstream tocou o `baseline.sql` em **729 commits**.
Enquanto as 134 linhas de `properties` moravam lá dentro, toda sincronização
colidia no mesmo lugar, e resolver conflito à mão num dump de schema é a maneira
mais fácil que existe de perder uma policy de isolamento sem ninguém perceber.

**Migration `9xxx` cria objeto nosso; objeto do upstream se ajusta no SQL
local.** A faixa `9xxx` é reservada a esta casa para nunca colidir com a
numeração dele (o `MANIFEST.md` conta que colisão de timestamp já quebrou o `db
push` de todo fork). E a cadeia de migrations é comparada com o `baseline.sql`
por `check-do-baseline-nao-diverge-da-cadeia.test.ts`: quando a 9001 redefinia o
CHECK de `crm_lead_links.target_kind`, a mesma constraint passava a aceitar
valores diferentes conforme o caminho, e aquele gate reprovava com razão. O
`alter` foi para `supabase/local/imoveis.sql`, onde não briga com nada.

## O que fazer numa sincronização

1. Trazer o upstream e resolver os conflitos que aparecerem, que serão nos
   arquivos que este fork possui.
2. Rodar `pnpm vitest run tests/unit/pontos-de-contato-do-fork.test.ts`. Ele é
   rápido, não precisa de banco, e cada falha já vem com o que repor.
3. Rodar `bash scripts/o-que-e-nosso.sh` para ver o inventário medido na hora,
   que é mais largo que esta tabela.
4. Só então a bateria completa.

O passo 2 antes do 4 é de propósito: ponto de contato perdido reprova longe, em
teste caro, com sintoma que fala de outra coisa. Aqui ele reprova em segundos,
dizendo o nome do arquivo e a linha que falta.

## Quando um ponto de contato deixar de ser necessário

O caso mais próximo é a navegação. A issue #1290 do upstream pede um item de
menu que só apareça com o módulo ligado; quando ela entrar, o destino de Imóveis
passa a se registrar pelo mecanismo dele, o spread em `catalogo.ts` some, e esta
tabela perde uma linha. Vale conferir o estado dela a cada sincronização grande,
porque a direção certa é esta tabela encolher.

## A dívida que ficou aberta, e por quê

A proteção de contato vale na ROTA, não no banco. `protegerContato` nula
telefone e e-mail antes de a API responder, mas o baseline dá `GRANT ALL ON
TABLE public.contacts TO authenticated` e a única regra da tabela isola por
organização. Postgres não filtra coluna por RLS, e a Data API do Supabase
responde na internet: um atendente com as próprias credenciais alcança a tabela
por fora do aplicativo.

A barreira foi escrita e medida em 21/09/2026, com `revoke select` na tabela e
`grant select` coluna a coluna derivado do catálogo. Ela funciona, e foi
retirada por duas colisões que o CI mostrou:

1. **dez funções do banco leem `contacts` sem `security definer`**, ou seja, com
   o privilégio de quem chama. `fn_activity_report` devolve `contact_phone` e é
   chamada pelo papel do usuário: com a coluna revogada, o relatório morre em
   "permission denied";
2. **os invariantes de isolamento do próprio upstream leem `contacts` e
   `contact_field_proposals` como usuário** para provar o recorte por
   organização. É o produto declarando que aquele papel lê aquelas tabelas.

Fechar isso é conserto do produto, não divergência de fork: ou as funções viram
`security definer` com recorte próprio, ou o dado sensível sai da tabela para
um lugar com ACL própria. Carregar a barreira só aqui significaria brigar com
cada função nova do upstream, para sempre.

O sentinela é `tests/invariants/contato-protegido-no-banco.test.ts`: ele afirma
o estado de hoje e fica vermelho no dia em que a porta fechar do outro lado.

Com a barreira fora, **as sete rotas que tinham virado `createAdminClient()` por
causa dela voltaram ao cliente da sessão** — cinco em 21/09 e as duas últimas
(`app/api/v1/contacts/duplicates` e `app/api/v1/ai/followups/queue`) em 22/09.
Sem barreira, o cliente privilegiado não protegia nada e era só mais um ponto de
contato com o upstream. Quem guarda `contacts/duplicates` é o gate `manager` da
própria rota, que continua sendo divergência desta casa.

Duas customizações a mais foram **aposentadas** em 22/09, pelo mesmo motivo das
cinco de 21/09 (o upstream passou a fazer o mesmo sozinho):

- o `.eq("organization_id")` extra no select e no update de
  `patchContactHandler` (achado I4). A v1.41.0 já filtra a organização nas duas
  consultas, na linha imediatamente acima; a linha desta casa virou duplicata.
  O comentário ficou no lugar dela, para o dia em que o filtro do upstream sair;
- a ausência do `?? contact.phone_number` no título continua sendo **nossa**; o
  que mudou é que o teste do upstream sobre o nome escolhido do contato
  (`automacao-e-agenda-chamam-o-contato-pelo-nome-escolhido.test.ts`, em
  `tests/unit/`) afirma o contrário, espera o telefone, e precisou ser ajustado
  aqui com a divergência escrita dentro do caso.
