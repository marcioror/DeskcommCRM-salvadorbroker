# Proteção de telefone/e-mail do lead para corretores — design

**Data:** 2026-08-09 · **Branch:** `feat/protecao-contato-corretor` · **Base:** `main@0a1b60a3`

## O problema

Hoje qualquer pessoa da equipe (viewer, agent, manager, admin) que enxerga um
lead enxerga também o telefone e o e-mail bruto do contato — em
`ContactsTable`, na página de detalhe do contato, no cabeçalho/lista/painel do
inbox de WhatsApp, e em qualquer integração externa autenticada por token
pessoal (API ou MCP).

Para uma imobiliária isso é um problema de negócio, não técnico: um corretor
(`agent`) pode atender um lead que **entrou sozinho pela imobiliária**
(WhatsApp, formulário do site) através do CRM, copiar o número exibido na
tela, e continuar a negociação por fora — "levando" o cliente da empresa.

O dono do CRM (`admin`) quer que corretores continuem vendo e atendendo
**todos** os leads da empresa pelo chat interno (pra puxar imóveis, dar
seguimento etc.), mas sem nunca enxergar o telefone/e-mail bruto de um lead
que não foi ele quem cadastrou.

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Regra de visibilidade | Telefone/e-mail visível só para quem `contacts.created_by_user_id` aponta como criador | Coluna já existe, já nullable, já é preenchida certo hoje (ver "Estado atual" abaixo) — zero mudança de schema |
| Quem é afetado | `viewer` e `agent` | Confirmado com o dono: viewer segue a mesma regra do corretor (não tem o risco de "levar cliente" reduzido só por não editar) |
| Quem sempre vê tudo | `manager` e `admin` | Confirmado com o dono: gestão precisa de visão completa pra supervisionar e intervir se necessário |
| O que esconder | Telefone **e** e-mail | Confirmado com o dono (email também é caminho de contato direto fora do CRM) |
| Como esconder | Oculta por completo (não mascara parcialmente) | Confirmado com o dono: mais seguro contra alguém decorar/anotar o resto do número. UI mostra "Protegido — atenda pelo chat do CRM" |
| Escopo (multi-tenant?) | Sempre ligado, sem configuração por organização | Dono confirmou que este fork é de uso próprio, não será distribuído a outras empresas — um `organizations.settings` toggle seria complexidade sem consumidor |
| Onde a trava mora | Camada de aplicação (nos handlers que já entregam o contato), não RLS/view no banco | RLS é *row-level* — não esconde uma coluna dentro de uma linha visível. Uma view/function nova no banco resolveria, mas exige migration + regenerar types + reescrever os pontos de leitura pra usá-la, sem ganho sobre um helper de aplicação simples de testar |
| Agente de IA (worker autônomo) | Não afetado | O worker do WhatsApp usa acesso interno de serviço, não a identidade de um `agent` humano — precisa do número real pra enviar mensagem e continua recebendo |

## Estado atual (confirmado no código)

- `contacts.created_by_user_id` (`supabase/baseline.sql:1343-1374`): `uuid`
  nullable, sem FK, sem default, sem trigger.
- Criação manual via API (`app/api/v1/contacts/_handler.ts:262`):
  `created_by_user_id: ctx.actor.type === "user" ? ctx.actor.id : null` — grava
  o autor humano.
- Criação automática via webhook inbound
  (`app/api/v1/webhooks/in/[token]/route.ts:202-213`): o insert **não inclui**
  `created_by_user_id` → fica `NULL`. É exatamente o caso "lead que entrou
  sozinho pela imobiliária".
- Já existe precedente de mascaramento no projeto: `lib/lgpd/mask.ts`
  (`maskEmail`/`maskPhone`), hoje usado só na prévia de exportação LGPD — não
  reaproveitável aqui porque a decisão foi por ocultação total, não parcial.
- O envio de mensagem (`lib/schemas/messaging.ts` `sendMessageSchema`) já
  trafega só por `conversation_id` — a UI nunca precisa do número bruto pra
  mandar mensagem. Confirma que ocultar o campo não quebra o chat.

## Arquitetura

**Núcleo puro testado — `lib/contacts/visibility.ts` (novo)**

```ts
export function podeVerContatoSensivel(params: {
  actorId: string | null;
  actorRole: "viewer" | "agent" | "manager" | "admin";
  contactCreatedByUserId: string | null;
}): boolean {
  if (params.actorRole === "manager" || params.actorRole === "admin") return true;
  return params.contactCreatedByUserId !== null && params.contactCreatedByUserId === params.actorId;
}

export function aplicarProtecaoDeContato<T extends { created_by_user_id: string | null; phone_number: string | null; email: string | null }>(
  contact: T,
  actor: { id: string | null; role: "viewer" | "agent" | "manager" | "admin" },
): T & { contact_protected: boolean } {
  const visivel = podeVerContatoSensivel({ actorId: actor.id, actorRole: actor.role, contactCreatedByUserId: contact.created_by_user_id });
  if (visivel) return { ...contact, contact_protected: false };
  return { ...contact, phone_number: null, email: null, contact_protected: true };
}
```

`contact_protected: true` é o sinal que a UI usa para diferenciar "sem
telefone cadastrado" (`contact_protected: false`, campo já `null`) de
"telefone existe mas está protegido" — sem isso a tela não sabe qual texto
mostrar.

**Pontos de leitura que passam a aplicar `aplicarProtecaoDeContato`:**

| Camada | Arquivo | O que muda |
|---|---|---|
| API contatos (get single + list) | `app/api/v1/contacts/_handler.ts` | Aplica antes de devolver a resposta |
| API conversas (embute contato) | `app/api/v1/conversations/_handler.ts:27` | Mesmo tratamento no objeto `contacts:` embutido |
| Ferramenta MCP | `lib/mcp/tools/contacts.ts:49-52,93` | Mesmo tratamento — um corretor que gera token pessoal de API/MCP não pode contornar a regra da UI |

**UI que passa a checar `contact_protected`:**

`ContactsTable.tsx`, `app/app/contacts/[id]/_client.tsx`,
`ConversationHeader.tsx`, `ConversationListItem.tsx`, `CRMSidePanel.tsx`,
`AdminSidePanel.tsx`/`AdminThread.tsx`/`InboxList.tsx` — trocam a renderização
direta de `phone_number`/`email` por: se `contact_protected`, mostrar badge
"Protegido — atenda pelo chat do CRM"; senão, comportamento atual.

**Sem migration.** `created_by_user_id` já existe e já é preenchido
corretamente nos dois fluxos de criação relevantes.

## Casos de borda

- **Lead criado pelo agente de IA** (`ctx.actor.type === "ai_agent"` →
  `created_by_user_id = null`): tratado igual a "entrou sozinho" — protegido
  para `viewer`/`agent`, visível para `manager`/`admin`. Coerente com a
  intenção (ninguém da equipe "trouxe" esse cliente).
- **Corretor edita um lead que não é dele**: fora de escopo — a permissão de
  editar já é regida pelo RBAC existente (`agent` só edita o que é seu,
  independente desta feature). Esta mudança é só sobre *leitura* de dado
  sensível.
- **Exportação de leads**: não existe rota de export de leads/contatos hoje
  (só audit log). Nada a proteger agora; se um export for criado no futuro,
  deve reusar `aplicarProtecaoDeContato`.

## Testes

- Unit (`lib/contacts/visibility.test.ts`): matriz de `podeVerContatoSensivel`
  cobrindo os 4 papéis × (criador = ator / criador = outro usuário / criador
  nulo).
- Integração dos handlers (`app/api/v1/contacts/_handler.test.ts`,
  `.../conversations/_handler.test.ts`): confirma que a resposta HTTP de fato
  vem com `phone_number`/`email` nulos e `contact_protected: true` quando o
  ator é `agent` e não é o criador; e completa quando é `manager`/`admin`.
- Não altera `tests/invariants/**` (sem RLS/schema novo) — roda só na suíte
  `test:unit`.

## Definition of Done desta feature

Sem tela nova (não precisa de entrada no `lib/navigation/registry.ts`), sem
migration, sem impacto em audit log (não é mutação). O checklist relevante do
CLAUDE.md aqui é: typecheck/lint/test:unit zerados, e prova visual (Playwright
ou manual) de que um usuário `agent` de teste vê o badge "Protegido" no lead
que não cadastrou e o telefone normal no que cadastrou.
