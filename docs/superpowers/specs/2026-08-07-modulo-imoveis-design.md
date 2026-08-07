# Módulo de Imóveis (venda/locação) + vínculo com leads — Design

**Data:** 2026-08-07 · **Status:** aprovado por Marcio (brainstorming) · **Escopo:** v1

## 1. Problema

O DeskcommCRM é multi-nicho por design (vocabulary configurável por pipeline), e "imobiliária" já é citada como nicho-alvo em `VISION.md`/PRD master, mas não existe hoje nenhuma estrutura dedicada a imóveis — nem tabela, nem tela. Corretores usando o CRM para venda/locação não têm onde cadastrar o imóvel nem como amarrar "esse lead está interessado nesses imóveis".

Este é o **primeiro vertical dedicado além do e-commerce** (que tem `orders` + integração Nuvemshop). Segue o mesmo padrão: tabela vertical própria, tenant-aware, que opera sobre o núcleo CRM (`crm_leads`, `crm_lead_links`) sem duplicá-lo.

## 2. Decisões de produto (travadas)

- **Origem dos dados**: cadastro manual pela UI do CRM. Sem sincronização com portal externo (VivaReal, ZAP, OLX) neste v1 — fica como evolução futura, e o schema não precisa prever isso agora (`orders` mostra que dá pra adicionar `external_provider`/`external_id` depois sem redesenho).
- **Vínculo lead↔imóvel**: muitos-para-muitos, manual. Reaproveita a tabela polimórfica `crm_lead_links` já existente (mesmo mecanismo usado hoje para `order`/`conversation`/`appointment`), em vez de criar uma tabela de junção nova.
- **Matching automático** (sugerir imóveis pro lead por preço/região/tipo): **fora de escopo deste v1**, fica pra uma spec futura depois que cadastro + vínculo manual estiverem validados em uso real.
- **Campos do imóvel**: nível "padrão de portal" — inclui condomínio, IPTU, ano de construção, mobiliado, aceita pet, características abertas (piscina, elevador, varanda...).
- **Permissões**: `agent`/`manager`/`admin` podem criar e editar imóveis e vínculos; `viewer` só visualiza — mesma régua de RBAC (`requireRole`) já usada no resto do CRM.
- **Fotos**: upload próprio via Supabase Storage, bucket privado, URLs assinadas (mesmo padrão do bucket `whatsapp-media`). Sem depender de link externo.
- **Vitrine pública / site**: fora de escopo. Módulo é 100% interno, atrás de login.
- **UI**: item novo "Imóveis" no sidebar (lista + filtros + detalhe), seção "Imóveis de interesse" no perfil do lead (Customer 360) pra vincular/desvincular.

## 3. Arquitetura

```
UI "Imóveis" (sidebar)          UI Customer 360 (lead)
   │ CRUD imóvel + fotos            │ seção "Imóveis de interesse"
   ▼                                ▼
/api/v1/properties/*          /api/v1/properties/[id]/leads
   │                                │ cria/remove crm_lead_links
   ▼                                │   (target_kind='property', link_kind='interested_in')
properties (tabela nova)            ▼
   │ 1:N                       crm_lead_links (existente, reusada)
   ▼                                │ mesma request grava
properties_media (tabela nova)      ▼
   (Supabase Storage:          crm_lead_activities (timeline do lead)
    bucket property-media)
```

Nenhum trigger novo faz HTTP (doutrina do repo). Nenhuma fila/worker novo é necessário — CRUD é síncrono via Route Handler, igual ao resto do CRM (isso não é integração externa, não tem webhook nem retry).

## 4. Modelo de dados

Duas tabelas novas, ambas `organization_id uuid not null references organizations(id) on delete cascade` + RLS `tenant_isolation_<tabela>_all` via `fn_user_org_ids()` (padrão obrigatório do repo).

### `properties`

| Coluna | Tipo/nota |
|---|---|
| `id` | uuid pk |
| `organization_id` | fk org |
| `title` | text not null |
| `description` | text null |
| `property_type` | text + check (`'house'\|'apartment'\|'land'\|'commercial'\|'rural'\|'other'`) |
| `purpose` | text + check (`'sale'\|'rent'\|'both'`) |
| `status` | text + check (`'available'\|'reserved'\|'sold'\|'rented'\|'inactive'`), default `'available'` |
| `price_sale_cents` | bigint null |
| `price_rent_cents` | bigint null |
| `currency` | text default `'BRL'` |
| `address_street`, `address_number`, `address_complement`, `address_neighborhood`, `address_city`, `address_state`, `address_zip` | text, maioria null exceto cidade/estado |
| `address_country` | text default `'BR'` |
| `latitude`, `longitude` | numeric null (geocoding fica fora de escopo v1; campos ficam prontos pra uso futuro em mapa) |
| `area_total_m2`, `area_useful_m2` | numeric null |
| `bedrooms`, `bathrooms`, `suites`, `parking_spots` | int null |
| `floor`, `construction_year` | int null |
| `condo_fee_cents`, `iptu_cents` | bigint null |
| `furnished`, `accepts_pets` | boolean default false |
| `features` | `text[]` default `'{}'` — características abertas (piscina, elevador...), mesmo padrão de `crm_leads.tags` (GIN index) |
| `owner_user_id` | uuid null — corretor responsável, mesmo padrão de `crm_leads.owner_user_id` |
| `created_by_user_id`, `created_at`, `updated_at` | padrão do repo (trigger `updated_at`) |

Colunas estruturadas (preço, área, quartos, tipo, status) em vez de `jsonb` **de propósito**: são os campos que a listagem precisa filtrar e ordenar — `jsonb` dificultaria isso (doutrina DIRC + anti-pattern "jsonb lock-in").

Índices: `(organization_id, status)`, `(organization_id, property_type, purpose)`, `(organization_id, price_sale_cents)`, `(organization_id, price_rent_cents)`, GIN em `features`, GIN em campos textuais de busca (`title`/endereço) se necessário via `pg_trgm` (mesmo padrão já usado em busca de leads/contacts, a confirmar no plano).

### `properties_media`

| Coluna | Tipo/nota |
|---|---|
| `id` | uuid pk |
| `organization_id` | fk org (denormalizado pra RLS direta, mesmo padrão de outras tabelas filhas) |
| `property_id` | fk `properties(id) on delete cascade` |
| `storage_path` | text not null — caminho no bucket `property-media` |
| `position` | int not null default 0 — `0` = foto de capa; ordenação simples (sem fractional indexing — não há drag-and-drop concorrente tipo kanban aqui) |
| `created_at` | timestamptz |

### Reuso de `crm_lead_links`

Migration altera o `CHECK` de `target_kind` pra incluir `'property'`:

```sql
check (target_kind in ('order','conversation','message','appointment','contact','lead','external','property'))
```

Vínculo lead↔imóvel: `lead_id`, `target_kind='property'`, `target_id=properties.id`, `link_kind='interested_in'` (valor novo, coluna já é texto livre — sem precisar de migration na constraint de `link_kind`, que não tem enum). Reverse lookup (imóvel → leads interessados) usa o índice já existente `idx_crm_lead_links_org_target`.

**Timeline**: não existe trigger de banco que grave `crm_lead_activities` a partir de `crm_lead_links` — isso é responsabilidade da camada de aplicação. Os endpoints `POST`/`DELETE /api/v1/properties/[id]/leads*` gravam a linha em `crm_lead_links` **e**, na mesma request, uma linha em `crm_lead_activities` (mesmo padrão que outras mutações do CRM já seguem). Usa o vocabulário aberto de `type` já documentado no CLAUDE.md (constante TypeScript compartilhada, ex. `property_linked`/`property_unlinked`, nunca string literal solta), sem entrar no invariante de vocabulário-banco-x-typescript (que só cobre colunas com CHECK).

### Bucket de Storage

`property-media`: bucket privado novo (mesmo padrão de `whatsapp-media`, migration dedicada), URLs assinadas com expiração curta geradas sob demanda pela API, nunca URL pública direta.

## 5. API (`/api/v1/`, JSON snake_case, `ok()`/`fail()`, Zod, audit log em toda mutação)

- `GET /api/v1/properties` — lista com filtros (`type`, `purpose`, `status`, faixa de preço, cidade) + paginação cursor.
- `POST /api/v1/properties` — cria (`agent`+).
- `GET /api/v1/properties/[id]` — detalhe, inclui mídia e leads vinculados.
- `PATCH /api/v1/properties/[id]` — edita (`agent`+).
- `DELETE /api/v1/properties/[id]` — soft: muda `status='inactive'` em vez de apagar linha (preserva histórico de vínculos com leads — mesmo espírito do anti-pattern "cascade fantasma").
- `POST /api/v1/properties/[id]/media` — upload de foto (URL assinada de upload + registra `properties_media`).
- `DELETE /api/v1/properties/[id]/media/[mediaId]` — remove foto.
- `POST /api/v1/properties/[id]/leads` — vincula lead (`lead_id` no body) → cria `crm_lead_links`.
- `DELETE /api/v1/properties/[id]/leads/[leadId]` — desvincula.

Todas as rotas seguem o fluxo padrão do repo: Zod valida input → `requireRole('agent')` (ou `viewer` pra GET) → `resolveActiveOrg()` → query filtrada por `organization_id` → `audit()` fire-and-forget nas mutações → `ok()`/`fail()`.

## 6. UI

- **Sidebar**: item "Imóveis", visível pra todos os papéis (viewer só sem botão de criar/editar).
- **Lista de imóveis**: grade com foto de capa, título, tipo, finalidade, preço, status; filtros no topo.
- **Detalhe do imóvel**: dados completos, galeria de fotos, lista de leads vinculados (com atalho pro perfil do lead), botão "vincular lead".
- **Customer 360 (perfil do lead)**: nova seção "Imóveis de interesse" — lista os imóveis vinculados, botão pra buscar/vincular outro.

## 7. Fora de escopo (v1)

- Matching automático (sugestão de imóveis por critério do lead) — fase futura.
- Importação/sincronização com portais imobiliários externos.
- Vitrine pública de imóveis fora do CRM.
- Geocoding automático de endereço (campos `latitude`/`longitude` existem no schema mas ficam null até então).

## 8. Migrations & baseline

Segue a doutrina do repo à risca: arquivo versionado em `supabase/migrations/` (próximo número sequencial após `0097`) + apêndice idempotente equivalente em `supabase/baseline.sql` + linha no `MANIFEST.md`. Duas migrations lógicas:

1. Tabelas `properties` + `properties_media` + índices + RLS + bucket `property-media`.
2. Alteração do CHECK de `crm_lead_links.target_kind` pra incluir `'property'` (idempotente: `drop constraint if exists` + `add constraint`).

Ambas aplicadas e validadas num Postgres descartável (`pgvector/pgvector:pg17`) nos dois modos, `install` e `update`, antes do PR — conforme Definition of Done.

## 9. Testes

- **Isolamento RLS**: 2 tenants, imóvel do tenant A não aparece pra tenant B (`tests/invariants/`).
- **RBAC**: `viewer` não consegue criar/editar/deletar imóvel nem vínculo (403).
- **Vínculo**: criar/remover vínculo lead↔imóvel gera linha em `crm_lead_activities`; `crm_lead_links` não duplica (índice único `(lead_id, target_kind, target_id, link_kind)` já existente cobre isso).
- **E2E (Playwright)**: fluxo completo pela tela — logar, cadastrar imóvel com foto, ir no perfil de um lead, vincular o imóvel, ver aparecer na timeline e na seção "Imóveis de interesse". Evidência visual conforme doutrina de QA Visual com Recursos Reais do CLAUDE.md.

## 10. Referências

- `docs/specs/02-spec-customer-360.md` §2.6 — `crm_lead_links` original.
- `docs/specs/06-spec-nuvemshop-lgpd.md` — padrão de tabela vertical (`orders`) usado como referência de forma, não de conteúdo (sem integração externa aqui).
- `CLAUDE.md` — doutrina de multi-tenancy, migrations, DIRC, anti-patterns, Definition of Done.
