# Módulo de Imóveis (venda/locação) + vínculo com leads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao DeskcommCRM um módulo de cadastro de imóveis (venda/locação) com fotos, e permitir vincular imóveis a leads (muitos-para-muitos), reaproveitando a tabela polimórfica `crm_lead_links` já existente.

**Architecture:** Duas tabelas novas tenant-aware (`properties`, `properties_media`) + bucket privado `property-media` no Supabase Storage. Vínculo lead↔imóvel reusa `crm_lead_links` (`target_kind='property'`). API REST síncrona sob `/api/v1/properties/*` seguindo o padrão simples de rota já usado em `webhook_sources` (sem indireção `_handler.ts`, sem MCP, sem event_log — CRUD comum). UI: item novo "Imóveis" no sidebar (lista + detalhe) e uma seção nova no `LeadDossier` (painel lateral do Kanban) pra vincular/desvincular.

**Tech Stack:** Next.js 16 App Router (Route Handlers), Supabase Postgres + RLS + Storage, Zod, TanStack Query, react-hook-form, shadcn/ui, Vitest, Playwright.

## Global Constraints

- `organization_id uuid not null references organizations(id) on delete cascade` em toda tabela nova; RLS `tenant_isolation_<tabela>_all` via `fn_user_org_ids()` — não negociável.
- Dinheiro sempre `_cents` (bigint) + `currency` (ISO-4217, default `'BRL'`).
- `type`/`status`/`property_type`/`purpose` são `text` + `check`, nunca enum Postgres.
- Toda mutação POST/PATCH/DELETE bem-sucedida grava 1 linha em `api_audit_log` via `audit()` (fire-and-forget).
- Zod valida todo input externo (body e querystring).
- API key/token nunca em query string; esta feature não introduz nenhum.
- Toda mudança de schema sai como migration versionada em `supabase/migrations/` **+** apêndice idempotente em `supabase/baseline.sql` **+** linha em `supabase/migrations/MANIFEST.md`.
- RBAC: `viewer` só lê; `agent`/`manager`/`admin` criam/editam/vinculam. Usa `requireRole()` de `lib/auth/require-role.ts`.
- `getUser()` sempre no server, nunca `getSession()`.
- Sem `console.log` no código final.
- Matching automático, importação de portal externo e vitrine pública **ficam fora deste plano** (ver spec §7).
- Spec de referência: `docs/superpowers/specs/2026-08-07-modulo-imoveis-design.md`.

---

## Task 1: Migration — tabelas `properties`/`properties_media`, RLS, bucket, extensão de `crm_lead_links`

**Files:**
- Create: `supabase/migrations/20260807000000_0098_properties.sql`
- Modify: `supabase/baseline.sql` (apêndice idempotente, no fim do arquivo)
- Modify: `supabase/migrations/MANIFEST.md` (nova linha na tabela "Applied" + entrada no inventário de tabelas)
- Modify: `tests/invariants/rls-isolation.test.ts`
- Test: `tests/invariants/rls-isolation.test.ts` (via `pnpm test:db`)

**Interfaces:**
- Produces: tabela `properties` (colunas: `id, organization_id, title, description, property_type, purpose, status, price_sale_cents, price_rent_cents, currency, address_street, address_number, address_complement, address_neighborhood, address_city, address_state, address_zip, address_country, latitude, longitude, area_total_m2, area_useful_m2, bedrooms, bathrooms, suites, parking_spots, floor, construction_year, condo_fee_cents, iptu_cents, furnished, accepts_pets, features, owner_user_id, created_by_user_id, created_at, updated_at`); tabela `properties_media` (`id, organization_id, property_id, storage_path, position, created_at`); bucket Storage `property-media`; `crm_lead_links.target_kind` CHECK passa a aceitar `'property'`.
- Consumes: função `fn_set_updated_at()` (já existe, `supabase/baseline.sql:719`), função `fn_user_org_ids()` (já existe).

- [ ] **Step 1: Escrever o arquivo de migration**

```sql
-- 0098: módulo de imóveis (venda/locação) — tabelas properties/properties_media,
-- bucket de fotos, e extensão do target_kind de crm_lead_links pra vincular
-- imóveis a leads (muitos-para-muitos). Ver spec
-- docs/superpowers/specs/2026-08-07-modulo-imoveis-design.md.

create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  title text not null check (length(title) > 0),
  description text,

  property_type text not null
    check (property_type in ('house','apartment','land','commercial','rural','other')),
  purpose text not null
    check (purpose in ('sale','rent','both')),
  status text not null default 'available'
    check (status in ('available','reserved','sold','rented','inactive')),

  price_sale_cents bigint,
  price_rent_cents bigint,
  currency text not null default 'BRL',

  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_state text,
  address_zip text,
  address_country text not null default 'BR',
  latitude numeric,
  longitude numeric,

  area_total_m2 numeric,
  area_useful_m2 numeric,
  bedrooms int,
  bathrooms int,
  suites int,
  parking_spots int,
  floor int,
  construction_year int,
  condo_fee_cents bigint,
  iptu_cents bigint,
  furnished boolean not null default false,
  accepts_pets boolean not null default false,

  features text[] not null default '{}',

  owner_user_id uuid,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_properties_org_status
  on properties (organization_id, status);
create index if not exists idx_properties_org_type_purpose
  on properties (organization_id, property_type, purpose);
create index if not exists idx_properties_org_price_sale
  on properties (organization_id, price_sale_cents);
create index if not exists idx_properties_org_price_rent
  on properties (organization_id, price_rent_cents);
create index if not exists idx_properties_features_gin
  on properties using gin (features);

drop trigger if exists trg_properties_updated_at on properties;
create trigger trg_properties_updated_at
  before update on properties
  for each row execute function fn_set_updated_at();

create table if not exists properties_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  storage_path text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_properties_media_property
  on properties_media (property_id, position);
create index if not exists idx_properties_media_org
  on properties_media (organization_id);

-- RLS (mesmo shape do padrão tenant_isolation_* do repo).
do $$
declare t text;
begin
  foreach t in array array['properties', 'properties_media'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_%s_all on public.%I', t, t);
    execute format(
      'create policy tenant_isolation_%s_all on public.%I for all
         using (organization_id in (select * from public.fn_user_org_ids()))
         with check (organization_id in (select * from public.fn_user_org_ids()))',
      t, t
    );
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Extensão do target_kind de crm_lead_links pra suportar vínculo lead↔imóvel.
alter table crm_lead_links
  drop constraint if exists crm_lead_links_target_kind_enum;
alter table crm_lead_links
  add constraint crm_lead_links_target_kind_enum
  check (target_kind in ('order','conversation','message','appointment','contact','lead','external','property'));

-- Bucket privado de fotos de imóvel — mesmo padrão de whatsapp-media (0055):
-- acesso só via service role (upload) + URL assinada (leitura), sem policies
-- de storage.objects para anon/authenticated.
insert into storage.buckets (id, name, public, file_size_limit)
values ('property-media', 'property-media', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;
```

- [ ] **Step 2: Aplicar a migration e validar install+update num Postgres descartável**

Run:
```bash
pnpm test:db
```
Expected: passa (a suíte já roda `install` fresh + `update` idempotente sobre `baseline.sql` — por isso o Step 3 precisa ter feito o apêndice ANTES de rodar isto).

- [ ] **Step 3: Adicionar o apêndice idempotente ao final de `supabase/baseline.sql`**

Abra `supabase/baseline.sql`, vá até o último bloco rotulado (`-- ---- ... (migration 0097) ----`) e adicione, logo depois:

```sql
-- ---- properties + properties_media + bucket property-media (migration 0098) ----
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(title) > 0),
  description text,
  property_type text not null check (property_type in ('house','apartment','land','commercial','rural','other')),
  purpose text not null check (purpose in ('sale','rent','both')),
  status text not null default 'available' check (status in ('available','reserved','sold','rented','inactive')),
  price_sale_cents bigint,
  price_rent_cents bigint,
  currency text not null default 'BRL',
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_state text,
  address_zip text,
  address_country text not null default 'BR',
  latitude numeric,
  longitude numeric,
  area_total_m2 numeric,
  area_useful_m2 numeric,
  bedrooms int,
  bathrooms int,
  suites int,
  parking_spots int,
  floor int,
  construction_year int,
  condo_fee_cents bigint,
  iptu_cents bigint,
  furnished boolean not null default false,
  accepts_pets boolean not null default false,
  features text[] not null default '{}',
  owner_user_id uuid,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_properties_org_status on public.properties (organization_id, status);
create index if not exists idx_properties_org_type_purpose on public.properties (organization_id, property_type, purpose);
create index if not exists idx_properties_org_price_sale on public.properties (organization_id, price_sale_cents);
create index if not exists idx_properties_org_price_rent on public.properties (organization_id, price_rent_cents);
create index if not exists idx_properties_features_gin on public.properties using gin (features);
drop trigger if exists trg_properties_updated_at on public.properties;
create trigger trg_properties_updated_at before update on public.properties for each row execute function public.fn_set_updated_at();

create table if not exists public.properties_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  storage_path text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_properties_media_property on public.properties_media (property_id, position);
create index if not exists idx_properties_media_org on public.properties_media (organization_id);

do $$
declare t text;
begin
  foreach t in array array['properties', 'properties_media'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_%s_all on public.%I', t, t);
    execute format(
      'create policy tenant_isolation_%s_all on public.%I for all
         using (organization_id in (select * from public.fn_user_org_ids()))
         with check (organization_id in (select * from public.fn_user_org_ids()))',
      t, t
    );
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

alter table public.crm_lead_links drop constraint if exists crm_lead_links_target_kind_enum;
alter table public.crm_lead_links add constraint crm_lead_links_target_kind_enum
  check (target_kind in ('order','conversation','message','appointment','contact','lead','external','property'));

insert into storage.buckets (id, name, public, file_size_limit)
values ('property-media', 'property-media', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;
```

- [ ] **Step 4: Registrar no MANIFEST**

Adicione ao final da tabela "Applied" em `supabase/migrations/MANIFEST.md`:

```
| `20260807000000` | `0098_properties` | Módulo de imóveis: tabelas `properties` (cadastro completo padrão-portal) e `properties_media` (fotos, bucket `property-media`), RLS tenant_isolation nas duas, e extensão do CHECK de `crm_lead_links.target_kind` para aceitar `'property'` — vínculo lead↔imóvel reusa a tabela polimórfica existente. |
```

E some `properties`, `properties_media` ao inventário `## Tables created (N total, ...)` no topo do arquivo, sob um novo grupo `Imóveis`.

- [ ] **Step 5: Rodar `pnpm test:db` de novo pra confirmar que baseline install+update passam com o apêndice**

Run: `pnpm test:db`
Expected: PASS (install fresh do baseline.sql cria as tabelas; update sobre banco já existente é idempotente).

- [ ] **Step 6: Estender o teste de isolamento RLS pras 2 tabelas novas**

Em `tests/invariants/rls-isolation.test.ts`, adicione `"properties"` e `"properties_media"` ao array `TABLES`, e no bloco de seed (`do $seed$ ... $seed$;`) insira uma linha de `properties` por org (e uma de `properties_media` referenciando ela), seguindo exatamente o mesmo formato das outras tabelas já seedadas nesse arquivo (mesmo padrão de UUID fixo por org, mesmas colunas obrigatórias preenchidas):

```sql
insert into public.properties (id, organization_id, title, property_type, purpose)
values ('11111111-1111-1111-1111-111111111p0a', '${ORG_A}', 'Apto teste A', 'apartment', 'sale')
on conflict (id) do nothing;
insert into public.properties (id, organization_id, title, property_type, purpose)
values ('11111111-1111-1111-1111-111111111p0b', '${ORG_B}', 'Apto teste B', 'apartment', 'sale')
on conflict (id) do nothing;
insert into public.properties_media (id, organization_id, property_id, storage_path)
values ('22222222-2222-2222-2222-222222222m0a', '${ORG_A}', '11111111-1111-1111-1111-111111111p0a', 'org-a/prop/photo.jpg')
on conflict (id) do nothing;
```

(Ajuste os UUIDs literais pro formato exato já usado nas outras linhas do arquivo — copie o padrão, não invente um novo esquema de ID.)

- [ ] **Step 7: Rodar a suíte de invariantes e confirmar isolamento**

Run: `pnpm test:db`
Expected: PASS, incluindo os 4 novos testes (`properties` e `properties_media` × cross-tenant=0 / own-org≥1).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260807000000_0098_properties.sql supabase/baseline.sql supabase/migrations/MANIFEST.md tests/invariants/rls-isolation.test.ts
git commit -m "feat(db): tabelas properties/properties_media + bucket property-media + crm_lead_links.target_kind='property'"
```

---

## Task 2: Zod schemas + tipos TypeScript do domínio

**Files:**
- Create: `lib/schemas/properties.ts`
- Modify: `lib/schemas/index.ts` (re-export)
- Create: `lib/types/properties.ts`
- Test: `lib/schemas/properties.test.ts`

**Interfaces:**
- Produces: `propertyCreateSchema`, `propertyPatchSchema`, `propertyListQuerySchema`, `propertyLeadLinkSchema` (todos exportados de `@/lib/schemas`); tipos `PropertyCreate`, `PropertyPatch`, `PropertyListQuery`; tipo `Property`, `PropertyMedia` (shape de linha do banco, `@/lib/types/properties`).
- Consumes: nada (schemas puros).

- [ ] **Step 1: Escrever o teste de validação (falha primeiro)**

```ts
// lib/schemas/properties.test.ts
import { describe, it, expect } from "vitest";
import { propertyCreateSchema, propertyPatchSchema, propertyLeadLinkSchema } from "./properties";

describe("propertyCreateSchema", () => {
  it("aceita um payload mínimo válido", () => {
    const parsed = propertyCreateSchema.safeParse({
      title: "Apto 2 quartos Centro",
      property_type: "apartment",
      purpose: "sale",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejeita title vazio", () => {
    const parsed = propertyCreateSchema.safeParse({
      title: "",
      property_type: "apartment",
      purpose: "sale",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita property_type fora da lista", () => {
    const parsed = propertyCreateSchema.safeParse({
      title: "X",
      property_type: "castle",
      purpose: "sale",
    });
    expect(parsed.success).toBe(false);
  });

  it("aceita features como array de strings e preços em cents", () => {
    const parsed = propertyCreateSchema.safeParse({
      title: "Casa com piscina",
      property_type: "house",
      purpose: "both",
      price_sale_cents: 85000000,
      price_rent_cents: 350000,
      features: ["piscina", "elevador"],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("propertyPatchSchema", () => {
  it("aceita patch parcial só com status", () => {
    const parsed = propertyPatchSchema.safeParse({ status: "reserved" });
    expect(parsed.success).toBe(true);
  });
});

describe("propertyLeadLinkSchema", () => {
  it("exige lead_id como uuid", () => {
    expect(propertyLeadLinkSchema.safeParse({ lead_id: "not-a-uuid" }).success).toBe(false);
    expect(
      propertyLeadLinkSchema.safeParse({ lead_id: "11111111-1111-1111-1111-111111111111" }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha (módulo não existe ainda)**

Run: `pnpm vitest run lib/schemas/properties.test.ts`
Expected: FAIL — `Cannot find module './properties'`.

- [ ] **Step 3: Implementar `lib/schemas/properties.ts`**

```ts
import { z } from "zod";

const PROPERTY_TYPES = ["house", "apartment", "land", "commercial", "rural", "other"] as const;
const PURPOSES = ["sale", "rent", "both"] as const;
const STATUSES = ["available", "reserved", "sold", "rented", "inactive"] as const;

export const propertyCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  property_type: z.enum(PROPERTY_TYPES),
  purpose: z.enum(PURPOSES),
  status: z.enum(STATUSES).default("available"),

  price_sale_cents: z.number().int().nonnegative().optional(),
  price_rent_cents: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).default("BRL"),

  address_street: z.string().max(200).optional(),
  address_number: z.string().max(20).optional(),
  address_complement: z.string().max(100).optional(),
  address_neighborhood: z.string().max(100).optional(),
  address_city: z.string().max(100).optional(),
  address_state: z.string().max(2).optional(),
  address_zip: z.string().max(9).optional(),
  address_country: z.string().length(2).default("BR"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),

  area_total_m2: z.number().positive().optional(),
  area_useful_m2: z.number().positive().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  suites: z.number().int().nonnegative().optional(),
  parking_spots: z.number().int().nonnegative().optional(),
  floor: z.number().int().optional(),
  construction_year: z.number().int().min(1800).max(2100).optional(),
  condo_fee_cents: z.number().int().nonnegative().optional(),
  iptu_cents: z.number().int().nonnegative().optional(),
  furnished: z.boolean().default(false),
  accepts_pets: z.boolean().default(false),

  features: z.array(z.string().min(1).max(50)).max(50).default([]),
  owner_user_id: z.string().uuid().optional(),
});
export type PropertyCreate = z.infer<typeof propertyCreateSchema>;

export const propertyPatchSchema = propertyCreateSchema.partial();
export type PropertyPatch = z.infer<typeof propertyPatchSchema>;

export const propertyListQuerySchema = z.object({
  search: z.string().optional(),
  property_type: z.enum(PROPERTY_TYPES).optional(),
  purpose: z.enum(PURPOSES).optional(),
  status: z.enum(STATUSES).optional(),
  price_min_cents: z.coerce.number().int().nonnegative().optional(),
  price_max_cents: z.coerce.number().int().nonnegative().optional(),
  city: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PropertyListQuery = z.infer<typeof propertyListQuerySchema>;

export const propertyLeadLinkSchema = z.object({
  lead_id: z.string().uuid(),
});
export type PropertyLeadLink = z.infer<typeof propertyLeadLinkSchema>;
```

- [ ] **Step 4: Criar os tipos de linha do banco em `lib/types/properties.ts`**

```ts
export type PropertyType = "house" | "apartment" | "land" | "commercial" | "rural" | "other";
export type PropertyPurpose = "sale" | "rent" | "both";
export type PropertyStatus = "available" | "reserved" | "sold" | "rented" | "inactive";

export interface Property {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  property_type: PropertyType;
  purpose: PropertyPurpose;
  status: PropertyStatus;
  price_sale_cents: number | null;
  price_rent_cents: number | null;
  currency: string;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  address_country: string;
  latitude: number | null;
  longitude: number | null;
  area_total_m2: number | null;
  area_useful_m2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  suites: number | null;
  parking_spots: number | null;
  floor: number | null;
  construction_year: number | null;
  condo_fee_cents: number | null;
  iptu_cents: number | null;
  furnished: boolean;
  accepts_pets: boolean;
  features: string[];
  owner_user_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PropertyMedia {
  id: string;
  organization_id: string;
  property_id: string;
  storage_path: string;
  position: number;
  created_at: string;
  /** Anexado pela API, não é coluna — URL assinada de leitura. */
  signed_url?: string;
}

export interface PropertyLeadLinkView {
  lead_id: string;
  lead_title: string;
  linked_at: string;
}
```

- [ ] **Step 5: Re-exportar em `lib/schemas/index.ts`**

Abra `lib/schemas/index.ts` e adicione, junto aos demais `export *` do arquivo:

```ts
export * from "./properties";
```

- [ ] **Step 6: Rodar o teste de novo e confirmar que passa**

Run: `pnpm vitest run lib/schemas/properties.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 7: Commit**

```bash
git add lib/schemas/properties.ts lib/schemas/properties.test.ts lib/schemas/index.ts lib/types/properties.ts
git commit -m "feat(properties): schemas Zod e tipos de domínio do módulo de imóveis"
```

---

## Task 3: API — `GET/POST /api/v1/properties`

**Files:**
- Create: `app/api/v1/properties/route.ts`
- Test: `app/api/v1/properties/route.test.ts`

**Interfaces:**
- Consumes: `requireRole` (`lib/auth/require-role.ts`), `ok`/`fail` (`lib/api/wrappers.ts`), `audit` (`lib/audit`), `propertyCreateSchema`/`propertyListQuerySchema` (`@/lib/schemas`), `createClient` (`lib/supabase/server.ts`).
- Produces: `GET /api/v1/properties` (paginado, filtros `property_type`/`purpose`/`status`/`price_min_cents`/`price_max_cents`/`city`/`search`), `POST /api/v1/properties` (cria, requer role `agent`+).

- [ ] **Step 1: Escrever o teste (RBAC + shape), rodar e confirmar que falha**

```ts
// app/api/v1/properties/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const USER = { id: "22222222-2222-2222-2222-222222222222" };

function makeDb(rows: unknown[] = []) {
  const inserted: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const terminal = { data: rows, error: null };
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(async () => terminal);
  chain.insert = vi.fn((row: unknown) => {
    inserted.push(row);
    return {
      select: () => ({
        single: async () => ({ data: { id: "prop-1", ...(row as object) }, error: null }),
      }),
    };
  });
  const supabase = { from: vi.fn(() => chain) };
  return { supabase, inserted };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/v1/properties", () => {
  it("viewer consegue listar (role mínima é viewer)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "viewer" },
    } as never);
    const { supabase } = makeDb([]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/properties"));
    expect(res.status).toBe(200);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("viewer");
  });
});

describe("POST /api/v1/properties", () => {
  it("viewer não consegue criar (403, nenhum insert)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= agent.", 403, {}),
    } as never);
    const { supabase, inserted } = makeDb();
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/v1/properties", {
      method: "POST",
      body: JSON.stringify({ title: "Casa", property_type: "house", purpose: "sale" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(inserted).toEqual([]);
  });

  it("agent cria com sucesso e chama requireRole com 'agent'", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase, inserted } = makeDb();
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/v1/properties", {
      method: "POST",
      body: JSON.stringify({ title: "Casa", property_type: "house", purpose: "sale" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("agent");
    expect(inserted[0]).toMatchObject({ organization_id: ORG_ID, title: "Casa" });
  });
});
```

Run: `pnpm vitest run app/api/v1/properties/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 2: Implementar `app/api/v1/properties/route.ts`**

```ts
/**
 * GET  /api/v1/properties — lista imóveis da org ativa (filtros + cursor).
 * POST /api/v1/properties — cria imóvel (requer role agent+).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { propertyCreateSchema, propertyListQuerySchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface CursorPayload {
  created_at: string;
  id: string;
}
function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}
function decodeCursor(raw: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as CursorPayload;
    if (typeof parsed.id !== "string" || typeof parsed.created_at !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest | Request): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const url = new URL(req.url);
  const qsParsed = propertyListQuerySchema.safeParse({
    search: url.searchParams.get("search") ?? undefined,
    property_type: url.searchParams.get("property_type") ?? undefined,
    purpose: url.searchParams.get("purpose") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    price_min_cents: url.searchParams.get("price_min_cents") ?? undefined,
    price_max_cents: url.searchParams.get("price_max_cents") ?? undefined,
    city: url.searchParams.get("city") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!qsParsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      details: qsParsed.error.flatten().fieldErrors,
      requestId,
    });
  }
  const q = qsParsed.data;

  const supabase = await createClient();
  let query = supabase
    .from("properties")
    .select("*")
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);

  if (q.property_type) query = query.eq("property_type", q.property_type);
  if (q.purpose) query = query.eq("purpose", q.purpose);
  if (q.status) query = query.eq("status", q.status);
  if (q.city) query = query.ilike("address_city", `%${q.city}%`);
  if (q.search) query = query.ilike("title", `%${q.search}%`);
  if (q.price_min_cents !== undefined) query = query.gte("price_sale_cents", q.price_min_cents);
  if (q.price_max_cents !== undefined) query = query.lte("price_sale_cents", q.price_max_cents);
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    if (!c) return fail("invalid_cursor", "Cursor inválido.", 400, { requestId });
    query = query.or(`created_at.lt.${c.created_at},and(created_at.eq.${c.created_at},id.lt.${c.id})`);
  }

  const { data, error } = await query;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const rows = data ?? [];
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ created_at: last.created_at, id: last.id }) : null;

  return ok(page, { requestId, meta: { cursor: nextCursor, has_more: hasMore } });
}

export async function POST(req: NextRequest | Request): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = propertyCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      details: parsed.error.flatten().fieldErrors,
      requestId,
    });
  }

  const supabase = await createClient();
  const { data: created, error: insErr } = await supabase
    .from("properties")
    .insert({
      organization_id: activeOrg.orgId,
      created_by_user_id: user.id,
      ...parsed.data,
    })
    .select("*")
    .single();
  if (insErr || !created) {
    return fail("internal_error", insErr?.message ?? "property_insert_failed", 500, { requestId });
  }

  void audit({
    action: "property.created",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "property",
    resourceId: created.id,
    requestId,
    metadata: { title: created.title, property_type: created.property_type, purpose: created.purpose },
  });

  return ok(created, { requestId, status: 201 });
}
```

- [ ] **Step 3: Adicionar `property.created` (e as demais ações que as próximas tasks vão usar: `property.updated`, `property.deactivated`, `property.media_added`, `property.media_removed`, `property.lead_linked`, `property.lead_unlinked`) a `lib/audit/actions.ts`**, seguindo o formato já usado pelas outras ações (`contact.created`, `webhook.source_created`, etc. — mesma união de string literals ou `as const` array, conforme o arquivo já usa).

- [ ] **Step 4: Adicionar os error codes que as próximas tasks vão precisar a `lib/api/errors.ts`**: `property_not_found`, `lead_not_found`, `duplicate_lead_link` — no mesmo objeto `ApiErrorCodes`, nos grupos de status apropriados (404 e 409).

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm vitest run app/api/v1/properties/route.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Rodar typecheck e lint**

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/properties/route.ts app/api/v1/properties/route.test.ts lib/audit/actions.ts lib/api/errors.ts
git commit -m "feat(api): GET/POST /api/v1/properties"
```

---

## Task 4: API — `GET/PATCH/DELETE /api/v1/properties/[id]`

**Files:**
- Create: `app/api/v1/properties/[id]/route.ts`
- Test: `app/api/v1/properties/[id]/route.test.ts`

**Interfaces:**
- Consumes: mesmos helpers da Task 3; `propertyPatchSchema` (`@/lib/schemas`).
- Produces: `GET` (detalhe — inclui `properties_media` via segunda query), `PATCH` (edita, requer `agent`+), `DELETE` (soft: `status='inactive'`, requer `agent`+ — **não apaga a linha**, preserva histórico de `crm_lead_links`).

- [ ] **Step 1: Escrever o teste, rodar, confirmar que falha**

```ts
// app/api/v1/properties/[id]/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROP_ID = "33333333-3333-3333-3333-333333333333";
const USER = { id: "22222222-2222-2222-2222-222222222222" };
const ctx = { params: Promise.resolve({ id: PROP_ID }) };

function makeDb(existing: Record<string, unknown> | null) {
  const updates: unknown[] = [];
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: existing, error: null }));
  chain.update = vi.fn((patch: unknown) => {
    updates.push(patch);
    return {
      eq: () => ({
        select: () => ({ single: async () => ({ data: { ...existing, ...(patch as object) }, error: null }) }),
      }),
    };
  });
  const supabase = { from: vi.fn(() => chain) };
  return { supabase, updates };
}

beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/v1/properties/[id] (soft)", () => {
  it("viewer não consegue desativar (403, nenhum update)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= agent.", 403, {}),
    } as never);
    const { supabase, updates } = makeDb({ id: PROP_ID, status: "available" });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(403);
    expect(updates).toEqual([]);
  });

  it("agent desativa: status vira 'inactive' via update, nunca DELETE físico", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase, updates } = makeDb({ id: PROP_ID, status: "available" });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ status: "inactive" });
  });

  it("404 quando o imóvel não existe na org ativa", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase } = makeDb(null);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), ctx as never);
    expect(res.status).toBe(404);
  });
});
```

Run: `pnpm vitest run "app/api/v1/properties/[id]/route.test.ts"`
Expected: FAIL — módulo `./route` não existe.

- [ ] **Step 2: Implementar `app/api/v1/properties/[id]/route.ts`**

```ts
/**
 * GET    /api/v1/properties/[id] — detalhe (inclui fotos).
 * PATCH  /api/v1/properties/[id] — edita (requer agent+).
 * DELETE /api/v1/properties/[id] — soft: status='inactive' (requer agent+).
 *   Nunca apaga a linha — preserva histórico de crm_lead_links (anti-pattern
 *   "cascade fantasma", CLAUDE.md).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { propertyPatchSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("viewer", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: property, error } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!property) return fail("property_not_found", "Imóvel não encontrado.", 404, { requestId });

  const { data: media } = await supabase
    .from("properties_media")
    .select("id, storage_path, position, created_at")
    .eq("property_id", id)
    .eq("organization_id", activeOrg.orgId)
    .order("position", { ascending: true });

  return ok({ ...property, media: media ?? [] }, { requestId });
}

export async function PATCH(req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = propertyPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      details: parsed.error.flatten().fieldErrors,
      requestId,
    });
  }

  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("properties")
    .select("id")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (fetchErr) return fail("internal_error", fetchErr.message, 500, { requestId });
  if (!existing) return fail("property_not_found", "Imóvel não encontrado.", 404, { requestId });

  const { data: updated, error: updErr } = await supabase
    .from("properties")
    .update(parsed.data)
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });

  void audit({
    action: "property.updated",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "property",
    resourceId: id,
    requestId,
    metadata: { changed_fields: Object.keys(parsed.data) },
  });

  return ok(updated, { requestId });
}

export async function DELETE(_req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("properties")
    .select("id, status")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (fetchErr) return fail("internal_error", fetchErr.message, 500, { requestId });
  if (!existing) return fail("property_not_found", "Imóvel não encontrado.", 404, { requestId });

  const { data: updated, error: updErr } = await supabase
    .from("properties")
    .update({ status: "inactive" })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });

  void audit({
    action: "property.deactivated",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "property",
    resourceId: id,
    requestId,
  });

  return ok(updated, { requestId });
}
```

- [ ] **Step 3: Rodar o teste e confirmar que passa**

Run: `pnpm vitest run "app/api/v1/properties/[id]/route.test.ts"`
Expected: PASS (3 testes).

- [ ] **Step 4: `pnpm typecheck && pnpm lint`**

Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add "app/api/v1/properties/[id]/route.ts" "app/api/v1/properties/[id]/route.test.ts"
git commit -m "feat(api): GET/PATCH/DELETE /api/v1/properties/[id] (delete = soft inactivate)"
```

---

## Task 5: API — upload e remoção de fotos do imóvel

**Files:**
- Create: `app/api/v1/properties/[id]/media/route.ts`
- Create: `app/api/v1/properties/[id]/media/[mediaId]/route.ts`
- Test: `app/api/v1/properties/[id]/media/route.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` (`lib/supabase/admin.ts`), bucket `property-media` (Task 1).
- Produces: `POST /api/v1/properties/[id]/media` (multipart `file`, upload buffered server-side, grava `properties_media`, retorna `signed_url`), `GET /api/v1/properties/[id]/media/[mediaId]` (redirect 302 pra URL assinada, mesmo padrão de `messages/[id]/media`), `DELETE /api/v1/properties/[id]/media/[mediaId]` (remove do storage + da tabela).

- [ ] **Step 1: Escrever o teste do POST (RBAC + storage path), rodar, confirmar que falha**

```ts
// app/api/v1/properties/[id]/media/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROP_ID = "33333333-3333-3333-3333-333333333333";
const USER = { id: "22222222-2222-2222-2222-222222222222" };
const ctx = { params: Promise.resolve({ id: PROP_ID }) };

beforeEach(() => vi.clearAllMocks());

function makeSupabase(propertyExists: boolean) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({
    data: propertyExists ? { id: PROP_ID } : null,
    error: null,
  }));
  chain.insert = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: { id: "media-1", property_id: PROP_ID, storage_path: "x" }, error: null }),
    }),
  }));
  return { from: vi.fn(() => chain) };
}

function makeAdmin() {
  const upload = vi.fn(async () => ({ error: null }));
  return { storage: { from: vi.fn(() => ({ upload })) } }, upload;
}

describe("POST /api/v1/properties/[id]/media", () => {
  it("viewer não consegue subir foto (403, sem upload)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= agent.", 403, {}),
    } as never);
    vi.mocked(createClient).mockResolvedValue(makeSupabase(true) as never);

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" }));
    const req = new Request("http://localhost", { method: "POST", body: form });

    const { POST } = await import("./route");
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(403);
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });

  it("agent sobe a foto e o caminho segue o padrão {org}/{property}/photo-*", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    vi.mocked(createClient).mockResolvedValue(makeSupabase(true) as never);
    const uploadSpy = vi.fn(async () => ({ error: null }));
    vi.mocked(createAdminClient).mockReturnValue({
      storage: { from: () => ({ upload: uploadSpy }) },
    } as never);

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" }));
    const req = new Request("http://localhost", { method: "POST", body: form });

    const { POST } = await import("./route");
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(201);
    const [path] = uploadSpy.mock.calls[0] as [string, Buffer, unknown];
    expect(path.startsWith(`${ORG_ID}/${PROP_ID}/photo-`)).toBe(true);
  });
});
```

Run: `pnpm vitest run "app/api/v1/properties/[id]/media/route.test.ts"`
Expected: FAIL — módulo `./route` não existe.

- [ ] **Step 2: Implementar validação de mídia reutilizando `lib/messaging/media/upload-validation.ts`**

Reuse `validateOutboundMedia`/`extFromMime` de `lib/messaging/media/` (já existentes, usados em `conversations/[id]/media/route.ts`) — não duplicar allowlist de mime/tamanho.

- [ ] **Step 3: Implementar `app/api/v1/properties/[id]/media/route.ts`**

```ts
/** POST /api/v1/properties/[id]/media — upload de foto (buffered, storage-first). */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extFromMime } from "@/lib/messaging/media/types";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: propertyId } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: property, error: fetchErr } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (fetchErr) return fail("internal_error", fetchErr.message, 500, { requestId });
  if (!property) return fail("property_not_found", "Imóvel não encontrado.", 404, { requestId });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", "Arquivo 'file' obrigatório.", 422, { requestId });
  }

  const validation = validateOutboundMedia({ mime: file.type, sizeBytes: file.size });
  if (!validation.ok) {
    return fail("validation_failed", validation.reason, 422, { requestId });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${activeOrg.orgId}/${propertyId}/photo-${randomUUID()}.${extFromMime(file.type)}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from("property-media")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (upErr) return fail("internal_error", upErr.message, 500, { requestId });

  const { count } = await supabase
    .from("properties_media")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId)
    .eq("organization_id", activeOrg.orgId);

  const { data: created, error: insErr } = await supabase
    .from("properties_media")
    .insert({
      organization_id: activeOrg.orgId,
      property_id: propertyId,
      storage_path: storagePath,
      position: count ?? 0,
    })
    .select("*")
    .single();
  if (insErr || !created) {
    return fail("internal_error", insErr?.message ?? "media_insert_failed", 500, { requestId });
  }

  void audit({
    action: "property.media_added",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "property",
    resourceId: propertyId,
    requestId,
    metadata: { media_id: created.id },
  });

  return ok(created, { requestId, status: 201 });
}
```

- [ ] **Step 4: Implementar `app/api/v1/properties/[id]/media/[mediaId]/route.ts`** (GET redirect assinado + DELETE)

```ts
/**
 * GET    /api/v1/properties/[id]/media/[mediaId] — redirect 302 pra URL assinada.
 * DELETE /api/v1/properties/[id]/media/[mediaId] — remove do storage + da tabela.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { fail, noContent } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_S = 3600;

interface RouteCtx {
  params: Promise<{ id: string; mediaId: string }>;
}

async function loadMedia(supabase: Awaited<ReturnType<typeof createClient>>, propertyId: string, mediaId: string, orgId: string) {
  return supabase
    .from("properties_media")
    .select("*")
    .eq("id", mediaId)
    .eq("property_id", propertyId)
    .eq("organization_id", orgId)
    .maybeSingle();
}

export async function GET(_req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: propertyId, mediaId } = await ctx.params;
  const authz = await requireRole("viewer", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: media, error } = await loadMedia(supabase, propertyId, mediaId, activeOrg.orgId);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!media) return fail("not_found", "Foto não encontrada.", 404, { requestId });

  const admin = createAdminClient();
  const { data: signed, error: signErr } = await admin.storage
    .from("property-media")
    .createSignedUrl(media.storage_path, SIGNED_URL_TTL_S);
  if (signErr || !signed?.signedUrl) {
    return fail("internal_error", signErr?.message ?? "sign_failed", 500, { requestId });
  }

  const response = NextResponse.redirect(signed.signedUrl, 302);
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export async function DELETE(_req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: propertyId, mediaId } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: media, error } = await loadMedia(supabase, propertyId, mediaId, activeOrg.orgId);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!media) return fail("not_found", "Foto não encontrada.", 404, { requestId });

  const admin = createAdminClient();
  await admin.storage.from("property-media").remove([media.storage_path]);

  const { error: delErr } = await supabase.from("properties_media").delete().eq("id", mediaId);
  if (delErr) return fail("internal_error", delErr.message, 500, { requestId });

  void audit({
    action: "property.media_removed",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "property",
    resourceId: propertyId,
    requestId,
    metadata: { media_id: mediaId },
  });

  return noContent(requestId);
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm vitest run "app/api/v1/properties/[id]/media/route.test.ts"`
Expected: PASS (2 testes).

- [ ] **Step 6: `pnpm typecheck && pnpm lint`**

Expected: sem erros. Se `extFromMime`/`validateOutboundMedia` tiverem assinatura diferente da assumida acima, ajuste as chamadas conforme a assinatura real em `lib/messaging/media/types.ts` e `lib/messaging/media/upload-validation.ts` (não redefinir localmente).

- [ ] **Step 7: Commit**

```bash
git add "app/api/v1/properties/[id]/media"
git commit -m "feat(api): upload/remoção de fotos do imóvel (bucket property-media)"
```

---

## Task 6: API — vincular/desvincular lead ao imóvel

**Files:**
- Create: `app/api/v1/properties/[id]/leads/route.ts`
- Create: `app/api/v1/properties/[id]/leads/[leadId]/route.ts`
- Test: `app/api/v1/properties/[id]/leads/route.test.ts`

**Interfaces:**
- Consumes: `propertyLeadLinkSchema` (Task 2), tabela `crm_lead_links` (`target_kind='property'`, `link_kind='interested_in'`), tabela `crm_lead_activities`.
- Produces: `GET /api/v1/properties/[id]/leads` (lista leads vinculados), `POST /api/v1/properties/[id]/leads` (`{ lead_id }` → cria vínculo + atividade), `DELETE /api/v1/properties/[id]/leads/[leadId]` (remove vínculo + atividade).

- [ ] **Step 1: Escrever o teste, rodar, confirmar que falha**

```ts
// app/api/v1/properties/[id]/leads/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROP_ID = "33333333-3333-3333-3333-333333333333";
const LEAD_ID = "44444444-4444-4444-4444-444444444444";
const USER = { id: "22222222-2222-2222-2222-222222222222" };
const ctx = { params: Promise.resolve({ id: PROP_ID }) };

beforeEach(() => vi.clearAllMocks());

function makeDb(opts: { propertyExists: boolean; leadExists: boolean; linkExists: boolean }) {
  const inserts: unknown[] = [];
  const tables: Record<string, unknown> = {
    properties: opts.propertyExists ? { id: PROP_ID } : null,
    crm_leads: opts.leadExists ? { id: LEAD_ID, title: "Lead X" } : null,
  };
  const supabase = {
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => {
        if (table === "crm_lead_links") return { data: opts.linkExists ? { id: "link-1" } : null, error: null };
        return { data: tables[table] ?? null, error: null };
      });
      chain.insert = vi.fn((row: unknown) => {
        inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: "link-1", ...(row as object) }, error: null }) }) };
      });
      return chain;
    }),
  };
  return { supabase, inserts };
}

describe("POST /api/v1/properties/[id]/leads", () => {
  it("viewer não consegue vincular (403, nenhum insert)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= agent.", 403, {}),
    } as never);
    const { supabase, inserts } = makeDb({ propertyExists: true, leadExists: true, linkExists: false });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost", { method: "POST", body: JSON.stringify({ lead_id: LEAD_ID }) });
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(403);
    expect(inserts).toEqual([]);
  });

  it("404 quando o lead não pertence à org ativa", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, user: USER, org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase } = makeDb({ propertyExists: true, leadExists: false, linkExists: false });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost", { method: "POST", body: JSON.stringify({ lead_id: LEAD_ID }) });
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(404);
  });

  it("409 quando o vínculo já existe (evita duplicar)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, user: USER, org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase } = makeDb({ propertyExists: true, leadExists: true, linkExists: true });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost", { method: "POST", body: JSON.stringify({ lead_id: LEAD_ID }) });
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(409);
  });

  it("agent vincula: insere em crm_lead_links E em crm_lead_activities", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, user: USER, org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { supabase, inserts } = makeDb({ propertyExists: true, leadExists: true, linkExists: false });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost", { method: "POST", body: JSON.stringify({ lead_id: LEAD_ID }) });
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(201);
    expect(inserts.some((i) => (i as { table: string }).table === "crm_lead_links")).toBe(true);
    expect(inserts.some((i) => (i as { table: string }).table === "crm_lead_activities")).toBe(true);
  });
});
```

Run: `pnpm vitest run "app/api/v1/properties/[id]/leads/route.test.ts"`
Expected: FAIL — módulo `./route` não existe.

- [ ] **Step 2: Implementar `app/api/v1/properties/[id]/leads/route.ts`**

```ts
/**
 * GET  /api/v1/properties/[id]/leads — lista leads vinculados a este imóvel.
 * POST /api/v1/properties/[id]/leads — vincula um lead (cria crm_lead_links
 *   target_kind='property' + uma linha em crm_lead_activities). Não há
 *   trigger de banco pra isso (crm_lead_links não tem trigger de atividade,
 *   ver spec §4) — as duas escritas acontecem aqui, na mesma request.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { propertyLeadLinkSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: propertyId } = await ctx.params;
  const authz = await requireRole("viewer", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: links, error } = await supabase
    .from("crm_lead_links")
    .select("lead_id, created_at, crm_leads(id, title)")
    .eq("organization_id", activeOrg.orgId)
    .eq("target_kind", "property")
    .eq("target_id", propertyId)
    .eq("link_kind", "interested_in");
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok(links ?? [], { requestId });
}

export async function POST(req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: propertyId } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = propertyLeadLinkSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      details: parsed.error.flatten().fieldErrors,
      requestId,
    });
  }
  const { lead_id: leadId } = parsed.data;

  const supabase = await createClient();

  const { data: property, error: propErr } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (propErr) return fail("internal_error", propErr.message, 500, { requestId });
  if (!property) return fail("property_not_found", "Imóvel não encontrado.", 404, { requestId });

  const { data: lead, error: leadErr } = await supabase
    .from("crm_leads")
    .select("id, title")
    .eq("id", leadId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (leadErr) return fail("internal_error", leadErr.message, 500, { requestId });
  if (!lead) return fail("lead_not_found", "Lead não encontrado.", 404, { requestId });

  const { data: existingLink, error: existErr } = await supabase
    .from("crm_lead_links")
    .select("id")
    .eq("organization_id", activeOrg.orgId)
    .eq("lead_id", leadId)
    .eq("target_kind", "property")
    .eq("target_id", propertyId)
    .eq("link_kind", "interested_in")
    .maybeSingle();
  if (existErr) return fail("internal_error", existErr.message, 500, { requestId });
  if (existingLink) return fail("duplicate_lead_link", "Este lead já está vinculado a este imóvel.", 409, { requestId });

  const { data: link, error: insErr } = await supabase
    .from("crm_lead_links")
    .insert({
      organization_id: activeOrg.orgId,
      lead_id: leadId,
      target_kind: "property",
      target_id: propertyId,
      link_kind: "interested_in",
    })
    .select("*")
    .single();
  if (insErr || !link) return fail("internal_error", insErr?.message ?? "link_insert_failed", 500, { requestId });

  await supabase.from("crm_lead_activities").insert({
    organization_id: activeOrg.orgId,
    lead_id: leadId,
    type: "property_linked",
    metadata: { property_id: propertyId, lead_link_id: link.id },
    created_by_user_id: user.id,
  });

  void audit({
    action: "property.lead_linked",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "property",
    resourceId: propertyId,
    requestId,
    metadata: { lead_id: leadId },
  });

  return ok(link, { requestId, status: 201 });
}
```

- [ ] **Step 3: Implementar `app/api/v1/properties/[id]/leads/[leadId]/route.ts`**

```ts
/** DELETE /api/v1/properties/[id]/leads/[leadId] — desvincula (remove crm_lead_links + registra atividade). */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, noContent } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; leadId: string }>;
}

export async function DELETE(_req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: propertyId, leadId } = await ctx.params;
  const authz = await requireRole("agent", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: link, error: fetchErr } = await supabase
    .from("crm_lead_links")
    .select("id")
    .eq("organization_id", activeOrg.orgId)
    .eq("lead_id", leadId)
    .eq("target_kind", "property")
    .eq("target_id", propertyId)
    .eq("link_kind", "interested_in")
    .maybeSingle();
  if (fetchErr) return fail("internal_error", fetchErr.message, 500, { requestId });
  if (!link) return fail("not_found", "Vínculo não encontrado.", 404, { requestId });

  const { error: delErr } = await supabase.from("crm_lead_links").delete().eq("id", link.id);
  if (delErr) return fail("internal_error", delErr.message, 500, { requestId });

  await supabase.from("crm_lead_activities").insert({
    organization_id: activeOrg.orgId,
    lead_id: leadId,
    type: "property_unlinked",
    metadata: { property_id: propertyId },
    created_by_user_id: user.id,
  });

  void audit({
    action: "property.lead_unlinked",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "property",
    resourceId: propertyId,
    requestId,
    metadata: { lead_id: leadId },
  });

  return noContent(requestId);
}
```

- [ ] **Step 4: Verificar o vocabulário aberto de `crm_lead_activities.type`**

Abra o arquivo onde as constantes de tipo de atividade já vivem (procure por `activity_type` ou pelo enum TS usado em `lib/leads/agent-activity.ts` da pesquisa da Task anterior) e adicione `property_linked`/`property_unlinked` como constantes exportadas — os dois `insert` acima devem importar e usar essas constantes, **nunca** a string literal solta (doutrina CLAUDE.md sobre vocabulário aberto). Ajuste os dois `type: "property_linked"` / `type: "property_unlinked"` pra `type: ACTIVITY_TYPE.PROPERTY_LINKED` (ou o nome real da constante encontrada).

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm vitest run "app/api/v1/properties/[id]/leads/route.test.ts"`
Expected: PASS (4 testes).

- [ ] **Step 6: `pnpm typecheck && pnpm lint`**

Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add "app/api/v1/properties/[id]/leads"
git commit -m "feat(api): vincular/desvincular lead a imóvel via crm_lead_links"
```

---

## Task 7: Hooks de dados (TanStack Query)

**Files:**
- Create: `hooks/properties/usePropertyList.ts`
- Create: `hooks/properties/useProperty.ts`
- Create: `hooks/properties/useCreateProperty.ts`
- Create: `hooks/properties/useUpdateProperty.ts`
- Create: `hooks/properties/useDeactivateProperty.ts`
- Create: `hooks/properties/usePropertyMedia.ts`
- Create: `hooks/properties/usePropertyLeadLinks.ts`

**Interfaces:**
- Consumes: `apiClient` (`lib/api/client.ts`), `Property`/`PropertyMedia` (`@/lib/types/properties`), `PropertyCreate`/`PropertyPatch` (`@/lib/schemas`).
- Produces: hooks usados pelas Tasks 9-11 (UI).

- [ ] **Step 1: `hooks/properties/usePropertyList.ts`**

```ts
"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Property } from "@/lib/types/properties";

interface ListResponse {
  data: Property[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

export interface PropertyListFilters {
  search?: string;
  property_type?: string;
  purpose?: string;
  status?: string;
  city?: string;
}

export function usePropertyList(filters: PropertyListFilters) {
  return useInfiniteQuery({
    queryKey: ["properties", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
      if (pageParam) qs.set("cursor", pageParam);
      qs.set("limit", "50");
      try {
        return await apiClient.get<ListResponse>(`/api/v1/properties?${qs.toString()}`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    getNextPageParam: (lastPage) => (lastPage.meta?.has_more ? lastPage.meta.cursor : undefined),
  });
}
```

- [ ] **Step 2: `hooks/properties/useProperty.ts`**

```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Property, PropertyMedia } from "@/lib/types/properties";

interface PropertyResponse {
  data: Property & { media: PropertyMedia[] };
}

export function useProperty(id: string) {
  return useQuery({
    queryKey: ["property", id],
    enabled: !!id,
    queryFn: async () => {
      try {
        return await apiClient.get<PropertyResponse>(`/api/v1/properties/${id}`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}
```

- [ ] **Step 3: `hooks/properties/useCreateProperty.ts`**

```ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Property } from "@/lib/types/properties";
import type { PropertyCreate } from "@/lib/schemas/properties";

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PropertyCreate) =>
      apiClient.post<{ data: Property }>("/api/v1/properties", input),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] }),
  });
}
```

- [ ] **Step 4: `hooks/properties/useUpdateProperty.ts`**

```ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Property } from "@/lib/types/properties";
import type { PropertyPatch } from "@/lib/schemas/properties";

export function useUpdateProperty(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: PropertyPatch) =>
      apiClient.patch<{ data: Property }>(`/api/v1/properties/${id}`, patch),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property", id] });
      qc.invalidateQueries({ queryKey: ["properties"] });
    },
  });
}
```

- [ ] **Step 5: `hooks/properties/useDeactivateProperty.ts`**

```ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Property } from "@/lib/types/properties";

export function useDeactivateProperty(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => apiClient.delete<{ data: Property }>(`/api/v1/properties/${id}`),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property", id] });
      qc.invalidateQueries({ queryKey: ["properties"] });
    },
  });
}
```

- [ ] **Step 6: `hooks/properties/usePropertyMedia.ts`** (upload multipart + delete)

```ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { ApiError } from "@/lib/api/types";
import type { PropertyMedia } from "@/lib/types/properties";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data?: T; error?: { code: string; message: string } };
  if (!res.ok || !body.data) {
    throw new ApiError(res.status, body.error?.code ?? "unknown_error", undefined, "", body.error?.message);
  }
  return body.data;
}

export function useUploadPropertyMedia(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/v1/properties/${propertyId}/media`, { method: "POST", body: form });
      return parseJsonOrThrow<PropertyMedia>(res);
    },
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property", propertyId] }),
  });
}

export function useDeletePropertyMedia(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mediaId: string) => {
      const res = await fetch(`/api/v1/properties/${propertyId}/media/${mediaId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json()) as { error?: { code: string; message: string } };
        throw new ApiError(res.status, body.error?.code ?? "unknown_error", undefined, "", body.error?.message);
      }
    },
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property", propertyId] }),
  });
}
```

- [ ] **Step 7: `hooks/properties/usePropertyLeadLinks.ts`** (leads vinculados a um imóvel — usado na tela de detalhe do imóvel; a versão "imóveis vinculados a um lead", usada no `LeadDossier`, é criada na Task 8 junto do componente que a consome)

```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface LinkedLead {
  lead_id: string;
  created_at: string;
  crm_leads: { id: string; title: string } | null;
}

export function usePropertyLeadLinks(propertyId: string) {
  return useQuery({
    queryKey: ["property-leads", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      try {
        return await apiClient.get<{ data: LinkedLead[] }>(`/api/v1/properties/${propertyId}/leads`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}

export function useLinkLeadToProperty(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) =>
      apiClient.post(`/api/v1/properties/${propertyId}/leads`, { lead_id: leadId }),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property-leads", propertyId] }),
  });
}

export function useUnlinkLeadFromProperty(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) =>
      apiClient.delete(`/api/v1/properties/${propertyId}/leads/${leadId}`),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property-leads", propertyId] }),
  });
}
```

- [ ] **Step 8: `pnpm typecheck`**

Expected: sem erros. Se `ApiError`/`showApiError`/`apiClient` tiverem assinaturas ligeiramente diferentes das assumidas, ajuste conforme `lib/api/types.ts` e `components/feedback/ApiErrorToast.tsx` reais (não redefinir).

- [ ] **Step 9: Commit**

```bash
git add hooks/properties
git commit -m "feat(properties): hooks TanStack Query (list/detail/mutations/media/lead-links)"
```

---

## Task 8: Sidebar — item "Imóveis"

**Files:**
- Modify: `components/shell/Sidebar.tsx`

**Interfaces:**
- Consumes: `Buildings` icon de `lib/ui/icons.ts` (já exportado — confirmado na pesquisa de código).
- Produces: link `/app/properties` visível a todos os papéis autenticados (sem gate de permissão — `viewer` só não vê botões de criar/editar dentro da página, igual "Contatos").

- [ ] **Step 1: Adicionar o item ao array `NAV_ITEMS`**

Em `components/shell/Sidebar.tsx`, adicione ao array `NAV_ITEMS` (logo após o item "Contatos", por afinidade de domínio CRM):

```ts
import { Buildings } from "@/lib/ui/icons"; // adicionar ao import existente de ícones

// dentro de NAV_ITEMS, depois de { href: "/app/contacts", label: "Contatos", icon: Users }:
{ href: "/app/properties", label: "Imóveis", icon: Buildings },
```

Sem `permission`, então o `.filter()` existente já deixa passar (`return true` no fallback) — nenhuma outra mudança necessária no arquivo.

- [ ] **Step 2: `pnpm typecheck && pnpm lint`**

Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/shell/Sidebar.tsx
git commit -m "feat(ui): item 'Imóveis' no sidebar"
```

---

## Task 9: Página de listagem `/app/properties`

**Files:**
- Create: `app/app/properties/page.tsx`
- Create: `app/app/properties/_client.tsx`
- Create: `app/app/properties/loading.tsx`
- Create: `components/properties/PropertyCard.tsx`
- Create: `components/properties/NewPropertyDialog.tsx`
- Create: `components/properties/PropertyForm.tsx`

**Interfaces:**
- Consumes: `usePropertyList` (Task 7), `useCreateProperty` (Task 7), `propertyCreateSchema` (Task 2).
- Produces: rota `/app/properties` navegável a partir do sidebar (Task 8), com link pra `/app/properties/[id]` (Task 10).

- [ ] **Step 1: `app/app/properties/page.tsx`** (server wrapper trivial, mesmo padrão de `app/app/contacts/page.tsx`)

```tsx
import { PropertiesListClient } from "./_client";

export default function PropertiesPage() {
  return <PropertiesListClient />;
}
```

- [ ] **Step 2: `app/app/properties/loading.tsx`**

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `components/properties/PropertyForm.tsx`** (reusa `parseReaisToCents`/`centsToReais` de `lib/money`, e o padrão de tags-como-string-separada-por-vírgula de `LeadFieldsForm`)

```tsx
"use client";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { propertyCreateSchema, type PropertyCreate } from "@/lib/schemas/properties";
import { parseReaisToCents, centsToReais } from "@/lib/money";
import type { Property } from "@/lib/types/properties";

interface FormShape {
  title: string;
  description: string;
  property_type: PropertyCreate["property_type"];
  purpose: PropertyCreate["purpose"];
  priceSaleReais: string;
  priceRentReais: string;
  address_city: string;
  address_state: string;
  bedrooms: string;
  bathrooms: string;
  parking_spots: string;
  area_total_m2: string;
  featuresRaw: string;
}

interface Props {
  initial?: Property;
  onSubmit: (input: PropertyCreate) => void;
  submitting?: boolean;
}

export function PropertyForm({ initial, onSubmit, submitting }: Props) {
  const form = useForm<FormShape>({
    defaultValues: {
      title: initial?.title ?? "",
      description: initial?.description ?? "",
      property_type: initial?.property_type ?? "apartment",
      purpose: initial?.purpose ?? "sale",
      priceSaleReais: centsToReais(initial?.price_sale_cents ?? null),
      priceRentReais: centsToReais(initial?.price_rent_cents ?? null),
      address_city: initial?.address_city ?? "",
      address_state: initial?.address_state ?? "",
      bedrooms: initial?.bedrooms?.toString() ?? "",
      bathrooms: initial?.bathrooms?.toString() ?? "",
      parking_spots: initial?.parking_spots?.toString() ?? "",
      area_total_m2: initial?.area_total_m2?.toString() ?? "",
      featuresRaw: (initial?.features ?? []).join(", "),
    },
  });

  function handleSubmit(values: FormShape) {
    const features = values.featuresRaw
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    const candidate = {
      title: values.title,
      description: values.description || undefined,
      property_type: values.property_type,
      purpose: values.purpose,
      price_sale_cents: values.priceSaleReais ? parseReaisToCents(values.priceSaleReais) : undefined,
      price_rent_cents: values.priceRentReais ? parseReaisToCents(values.priceRentReais) : undefined,
      address_city: values.address_city || undefined,
      address_state: values.address_state || undefined,
      bedrooms: values.bedrooms ? Number(values.bedrooms) : undefined,
      bathrooms: values.bathrooms ? Number(values.bathrooms) : undefined,
      parking_spots: values.parking_spots ? Number(values.parking_spots) : undefined,
      area_total_m2: values.area_total_m2 ? Number(values.area_total_m2) : undefined,
      features,
    };
    const parsed = propertyCreateSchema.safeParse(candidate);
    if (!parsed.success) return;
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="title">Título</Label>
        <Input id="title" {...form.register("title", { required: true })} />
      </div>
      <div>
        <Label htmlFor="description">Descrição</Label>
        <Textarea id="description" {...form.register("description")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Tipo</Label>
          <Select
            value={form.watch("property_type")}
            onValueChange={(v) => form.setValue("property_type", v as FormShape["property_type"])}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="house">Casa</SelectItem>
              <SelectItem value="apartment">Apartamento</SelectItem>
              <SelectItem value="land">Terreno</SelectItem>
              <SelectItem value="commercial">Comercial</SelectItem>
              <SelectItem value="rural">Rural</SelectItem>
              <SelectItem value="other">Outro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Finalidade</Label>
          <Select
            value={form.watch("purpose")}
            onValueChange={(v) => form.setValue("purpose", v as FormShape["purpose"])}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sale">Venda</SelectItem>
              <SelectItem value="rent">Locação</SelectItem>
              <SelectItem value="both">Venda e locação</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="priceSaleReais">Preço de venda (R$)</Label>
          <Input id="priceSaleReais" placeholder="850.000,00" {...form.register("priceSaleReais")} />
        </div>
        <div>
          <Label htmlFor="priceRentReais">Preço de locação (R$)</Label>
          <Input id="priceRentReais" placeholder="3.500,00" {...form.register("priceRentReais")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="address_city">Cidade</Label>
          <Input id="address_city" {...form.register("address_city")} />
        </div>
        <div>
          <Label htmlFor="address_state">UF</Label>
          <Input id="address_state" maxLength={2} {...form.register("address_state")} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div>
          <Label htmlFor="bedrooms">Quartos</Label>
          <Input id="bedrooms" type="number" {...form.register("bedrooms")} />
        </div>
        <div>
          <Label htmlFor="bathrooms">Banheiros</Label>
          <Input id="bathrooms" type="number" {...form.register("bathrooms")} />
        </div>
        <div>
          <Label htmlFor="parking_spots">Vagas</Label>
          <Input id="parking_spots" type="number" {...form.register("parking_spots")} />
        </div>
        <div>
          <Label htmlFor="area_total_m2">Área (m²)</Label>
          <Input id="area_total_m2" type="number" {...form.register("area_total_m2")} />
        </div>
      </div>
      <div>
        <Label htmlFor="featuresRaw">Características (separadas por vírgula)</Label>
        <Input id="featuresRaw" placeholder="piscina, elevador, varanda" {...form.register("featuresRaw")} />
      </div>
      <Button type="submit" disabled={submitting}>
        {initial ? "Salvar alterações" : "Cadastrar imóvel"}
      </Button>
    </form>
  );
}
```

O código acima segue o mesmo padrão de `LeadFieldsForm`: sem `zodResolver`, validação manual via `propertyCreateSchema.safeParse(...)` dentro de `handleSubmit`. Não adicione a dependência `@hookform/resolvers/zod` — não é usada em nenhum outro formulário do repo, e este não é o lugar pra introduzi-la.

- [ ] **Step 4: `components/properties/NewPropertyDialog.tsx`**

```tsx
"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PropertyForm } from "./PropertyForm";
import { useCreateProperty } from "@/hooks/properties/useCreateProperty";
import type { PropertyCreate } from "@/lib/schemas/properties";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function NewPropertyDialog({ open, onOpenChange }: Props) {
  const create = useCreateProperty();

  function handleSubmit(input: PropertyCreate) {
    create.mutate(input, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo imóvel</DialogTitle>
        </DialogHeader>
        <PropertyForm onSubmit={handleSubmit} submitting={create.isPending} />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: `components/properties/PropertyCard.tsx`**

```tsx
"use client";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Property } from "@/lib/types/properties";

const STATUS_LABEL: Record<Property["status"], string> = {
  available: "Disponível",
  reserved: "Reservado",
  sold: "Vendido",
  rented: "Alugado",
  inactive: "Inativo",
};

function formatBRL(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

export function PropertyCard({ property }: { property: Property }) {
  return (
    <Link href={`/app/properties/${property.id}`}>
      <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:border-primary">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium leading-tight">{property.title}</h3>
          <Badge variant="outline">{STATUS_LABEL[property.status]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {property.address_city ?? "—"}
          {property.address_state ? ` · ${property.address_state}` : ""}
        </p>
        <div className="mt-auto flex items-center justify-between text-sm">
          <span className="font-medium tabular-nums">
            {property.purpose === "rent" ? formatBRL(property.price_rent_cents) : formatBRL(property.price_sale_cents)}
          </span>
          <span className="text-muted-foreground">
            {property.bedrooms ?? 0} qts · {property.bathrooms ?? 0} banh · {property.parking_spots ?? 0} vgs
          </span>
        </div>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 6: `app/app/properties/_client.tsx`**

```tsx
"use client";
import { useMemo, useState } from "react";
import { Plus, MagnifyingGlass } from "@/lib/ui/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePropertyList } from "@/hooks/properties/usePropertyList";
import { PropertyCard } from "@/components/properties/PropertyCard";
import { NewPropertyDialog } from "@/components/properties/NewPropertyDialog";

export function PropertiesListClient() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const filters = useMemo(() => ({ search: search || undefined }), [search]);
  const q = usePropertyList(filters);
  const allProperties = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Imóveis</h1>
          <p className="text-sm text-muted-foreground">Cadastro de imóveis para venda e locação.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Novo imóvel
        </Button>
      </header>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2">
        <MagnifyingGlass className="ml-2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por título..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-0 shadow-none focus-visible:ring-0"
        />
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Não foi possível carregar os imóveis.
        </Card>
      ) : allProperties.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Nenhum imóvel cadastrado ainda. Clique em "Novo imóvel" para começar.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allProperties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
          {q.hasNextPage && (
            <Button variant="outline" onClick={() => q.fetchNextPage()}>
              Carregar mais
            </Button>
          )}
        </>
      )}

      <NewPropertyDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
```

- [ ] **Step 7: `pnpm typecheck && pnpm lint`**

Expected: sem erros. Confirme os nomes exatos exportados por `@/lib/ui/icons` (`Plus`, `MagnifyingGlass`) e por `@/components/ui/select` (`Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`) contra os arquivos reais — ajuste imports se algum nome divergir.

- [ ] **Step 8: Rodar o dev server e conferir visualmente**

Run: `pnpm dev`, abrir `http://localhost:3000/app/properties`, logar como `agent`+, clicar "Novo imóvel", preencher e salvar, confirmar que o card aparece na grade.

- [ ] **Step 9: Commit**

```bash
git add app/app/properties components/properties
git commit -m "feat(ui): página de listagem /app/properties + formulário de cadastro"
```

---

## Task 10: Página de detalhe `/app/properties/[id]`

**Files:**
- Create: `app/app/properties/[id]/page.tsx`
- Create: `app/app/properties/[id]/_client.tsx`
- Create: `components/properties/PropertyGallery.tsx`
- Create: `components/properties/PropertyLinkedLeads.tsx`
- Create: `components/properties/LinkLeadDialog.tsx`
- Create: `components/properties/EditPropertyDialog.tsx`

**Interfaces:**
- Consumes: `useProperty`, `useUpdateProperty`, `useDeactivateProperty`, `useUploadPropertyMedia`, `useDeletePropertyMedia` (Task 7), `usePropertyLeadLinks`/`useLinkLeadToProperty`/`useUnlinkLeadFromProperty` (Task 7), `PropertyForm` (Task 9).

- [ ] **Step 1: `app/app/properties/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { PropertyDetailClient } from "./_client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PropertyDetailPage({ params }: Props) {
  const { id } = await params;
  if (!id) notFound();
  return <PropertyDetailClient propertyId={id} />;
}
```

- [ ] **Step 2: `components/properties/PropertyGallery.tsx`** (fotos + upload)

```tsx
"use client";
import { useRef } from "react";
import { Trash, Plus } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { useUploadPropertyMedia, useDeletePropertyMedia } from "@/hooks/properties/usePropertyMedia";
import type { PropertyMedia } from "@/lib/types/properties";

interface Props {
  propertyId: string;
  media: PropertyMedia[];
}

export function PropertyGallery({ propertyId, media }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadPropertyMedia(propertyId);
  const remove = useDeletePropertyMedia(propertyId);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {media.map((m) => (
          <div key={m.id} className="group relative aspect-square overflow-hidden rounded-md border border-border">
            <img
              src={`/api/v1/properties/${propertyId}/media/${m.id}`}
              alt="Foto do imóvel"
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => remove.mutate(m.id)}
              className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-1 text-white group-hover:block"
              aria-label="Remover foto"
            >
              <Trash className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
          className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="h-6 w-6" />
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: `components/properties/LinkLeadDialog.tsx`** (busca lead existente e vincula — reusa a listagem de leads já exposta em `/api/v1/leads` pra busca)

```tsx
"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useLinkLeadToProperty } from "@/hooks/properties/usePropertyLeadLinks";

interface LeadSearchResult {
  id: string;
  title: string;
}

interface Props {
  propertyId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function LinkLeadDialog({ propertyId, open, onOpenChange }: Props) {
  const [search, setSearch] = useState("");
  const link = useLinkLeadToProperty(propertyId);

  const q = useQuery({
    queryKey: ["lead-search", search],
    enabled: open && search.length >= 2,
    queryFn: async () =>
      apiClient.get<{ data: LeadSearchResult[] }>(`/api/v1/leads?search=${encodeURIComponent(search)}&limit=10`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular lead</DialogTitle>
        </DialogHeader>
        <Input placeholder="Buscar lead pelo título..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {(q.data?.data ?? []).map((lead) => (
            <button
              key={lead.id}
              type="button"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() =>
                link.mutate(lead.id, {
                  onSuccess: () => onOpenChange(false),
                })
              }
            >
              <span>{lead.title}</span>
              <Button size="sm" variant="ghost" disabled={link.isPending}>
                Vincular
              </Button>
            </button>
          ))}
          {search.length >= 2 && q.data?.data.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">Nenhum lead encontrado.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Confirme antes de implementar que `GET /api/v1/leads?search=...` aceita e realmente filtra por `search` — se o parâmetro de busca do endpoint real de leads tiver outro nome, ajuste a query string acima (não é um endpoint criado por este plano, é reuso do que já existe).

- [ ] **Step 4: `components/properties/PropertyLinkedLeads.tsx`**

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { X } from "@/lib/ui/icons";
import { usePropertyLeadLinks, useUnlinkLeadFromProperty } from "@/hooks/properties/usePropertyLeadLinks";
import { LinkLeadDialog } from "./LinkLeadDialog";

export function PropertyLinkedLeads({ propertyId }: { propertyId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const q = usePropertyLeadLinks(propertyId);
  const unlink = useUnlinkLeadFromProperty(propertyId);
  const links = q.data?.data ?? [];

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Leads interessados</h3>
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
          Vincular lead
        </Button>
      </div>
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum lead vinculado ainda.</p>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.lead_id} className="flex items-center justify-between text-sm">
              <span>{l.crm_leads?.title ?? l.lead_id}</span>
              <button
                type="button"
                onClick={() => unlink.mutate(l.lead_id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Desvincular"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <LinkLeadDialog propertyId={propertyId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  );
}
```

- [ ] **Step 5: `components/properties/EditPropertyDialog.tsx`**

```tsx
"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PropertyForm } from "./PropertyForm";
import { useUpdateProperty } from "@/hooks/properties/useUpdateProperty";
import type { Property } from "@/lib/types/properties";
import type { PropertyCreate } from "@/lib/schemas/properties";

interface Props {
  property: Property;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function EditPropertyDialog({ property, open, onOpenChange }: Props) {
  const update = useUpdateProperty(property.id);

  function handleSubmit(input: PropertyCreate) {
    update.mutate(input, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar imóvel</DialogTitle>
        </DialogHeader>
        <PropertyForm initial={property} onSubmit={handleSubmit} submitting={update.isPending} />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: `app/app/properties/[id]/_client.tsx`**

```tsx
"use client";
import { useState } from "react";
import { PencilSimple } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProperty } from "@/hooks/properties/useProperty";
import { useDeactivateProperty } from "@/hooks/properties/useDeactivateProperty";
import { PropertyGallery } from "@/components/properties/PropertyGallery";
import { PropertyLinkedLeads } from "@/components/properties/PropertyLinkedLeads";
import { EditPropertyDialog } from "@/components/properties/EditPropertyDialog";

export function PropertyDetailClient({ propertyId }: { propertyId: string }) {
  const [editOpen, setEditOpen] = useState(false);
  const q = useProperty(propertyId);
  const deactivate = useDeactivateProperty(propertyId);

  if (q.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (q.isError || !q.data?.data) {
    return (
      <div className="p-6">
        <Card className="p-6 text-center text-sm text-muted-foreground">Imóvel não encontrado.</Card>
      </div>
    );
  }

  const property = q.data.data;

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{property.title}</h1>
          <p className="text-sm text-muted-foreground">
            {property.address_city ?? "—"} {property.address_state ? `· ${property.address_state}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{property.status}</Badge>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <PencilSimple className="mr-2 h-4 w-4" /> Editar
          </Button>
          {property.status !== "inactive" && (
            <Button variant="destructive" onClick={() => deactivate.mutate()} disabled={deactivate.isPending}>
              Desativar
            </Button>
          )}
        </div>
      </header>

      <Card className="p-4">
        <PropertyGallery propertyId={propertyId} media={property.media} />
      </Card>

      <Card className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-muted-foreground">Tipo</dt><dd>{property.property_type}</dd></div>
        <div><dt className="text-muted-foreground">Finalidade</dt><dd>{property.purpose}</dd></div>
        <div><dt className="text-muted-foreground">Quartos</dt><dd>{property.bedrooms ?? "—"}</dd></div>
        <div><dt className="text-muted-foreground">Banheiros</dt><dd>{property.bathrooms ?? "—"}</dd></div>
        <div><dt className="text-muted-foreground">Vagas</dt><dd>{property.parking_spots ?? "—"}</dd></div>
        <div><dt className="text-muted-foreground">Área</dt><dd>{property.area_total_m2 ?? "—"} m²</dd></div>
      </Card>

      {property.description && (
        <Card className="p-4 text-sm">{property.description}</Card>
      )}

      <PropertyLinkedLeads propertyId={propertyId} />

      <EditPropertyDialog property={property} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}
```

- [ ] **Step 7: `pnpm typecheck && pnpm lint`**

Expected: sem erros.

- [ ] **Step 8: Rodar o dev server e conferir visualmente**

Run: `pnpm dev`, abrir um imóvel criado na Task 9, subir uma foto, editar campos, vincular um lead existente e confirmar que aparece na lista "Leads interessados", desvincular e confirmar que some.

- [ ] **Step 9: Commit**

```bash
git add "app/app/properties/[id]" components/properties/PropertyGallery.tsx components/properties/PropertyLinkedLeads.tsx components/properties/LinkLeadDialog.tsx components/properties/EditPropertyDialog.tsx
git commit -m "feat(ui): página de detalhe do imóvel (fotos, edição, leads vinculados)"
```

---

## Task 11: `LeadDossier` — seção "Imóveis de interesse"

**Files:**
- Create: `hooks/leads/useLeadInterestedProperties.ts`
- Create: `components/kanban/LeadInterestedProperties.tsx`
- Modify: `components/kanban/LeadDossier.tsx`

**Interfaces:**
- Consumes: `crm_lead_links` via um novo endpoint simétrico ao da Task 6 — **reaproveita as mesmas rotas**: como `crm_lead_links` é indexado por `(lead_id, target_kind, target_id)`, listar "imóveis de um lead" é uma query diferente da Task 6 (que lista "leads de um imóvel"). Esse endpoint ainda não existe — criado no Step 1 abaixo.
- Produces: nova seção no `LeadDossier`, entre a timeline (`② timeline`) e os campos (`③ campos`), igual descrito na spec §6.

- [ ] **Step 1: Criar `GET /api/v1/leads/[id]/properties` e reusar `POST/DELETE .../properties/[id]/leads` (não duplicar a escrita)**

Crie `app/api/v1/leads/[id]/properties/route.ts` **somente com GET** (a escrita de vínculo já existe nas rotas da Task 6 — este endpoint é só a leitura simétrica, "imóveis deste lead" em vez de "leads deste imóvel"):

```ts
/** GET /api/v1/leads/[id]/properties — imóveis vinculados a este lead. */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;
  const authz = await requireRole("viewer", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: links, error } = await supabase
    .from("crm_lead_links")
    .select("target_id, created_at, properties(id, title, status, price_sale_cents, price_rent_cents)")
    .eq("organization_id", activeOrg.orgId)
    .eq("lead_id", leadId)
    .eq("target_kind", "property")
    .eq("link_kind", "interested_in");
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok(links ?? [], { requestId });
}
```

Escrever o teste ANTES da implementação, seguindo exatamente o mesmo formato de mocks (`requireRole`/`createClient`) usado em `app/api/v1/properties/[id]/leads/route.test.ts` (Task 6) — arquivo `app/api/v1/leads/[id]/properties/route.test.ts`, cobrindo: viewer consegue ler (200), retorna a lista mapeada. Rodar `pnpm vitest run "app/api/v1/leads/[id]/properties/route.test.ts"` antes (FAIL, módulo não existe) e depois de implementar (PASS).

- [ ] **Step 2: `hooks/leads/useLeadInterestedProperties.ts`**

```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface LinkedProperty {
  target_id: string;
  created_at: string;
  properties: {
    id: string;
    title: string;
    status: string;
    price_sale_cents: number | null;
    price_rent_cents: number | null;
  } | null;
}

export function useLeadInterestedProperties(leadId: string | null) {
  return useQuery({
    queryKey: ["lead-properties", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      try {
        return await apiClient.get<{ data: LinkedProperty[] }>(`/api/v1/leads/${leadId}/properties`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}

export function useLinkPropertyToLead(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (propertyId: string) =>
      apiClient.post(`/api/v1/properties/${propertyId}/leads`, { lead_id: leadId }),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead-properties", leadId] }),
  });
}

export function useUnlinkPropertyFromLead(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (propertyId: string) =>
      apiClient.delete(`/api/v1/properties/${propertyId}/leads/${leadId}`),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead-properties", leadId] }),
  });
}
```

- [ ] **Step 3: `components/kanban/LeadInterestedProperties.tsx`**

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { X } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import {
  useLeadInterestedProperties,
  useUnlinkPropertyFromLead,
} from "@/hooks/leads/useLeadInterestedProperties";
import { LinkPropertyDialog } from "./LinkPropertyDialog";

function formatBRL(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

export function LeadInterestedProperties({ leadId }: { leadId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const q = useLeadInterestedProperties(leadId);
  const unlink = useUnlinkPropertyFromLead(leadId);
  const items = q.data?.data ?? [];

  return (
    <section className="border-t border-border py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">Imóveis de interesse</h3>
        <Button size="sm" variant="ghost" onClick={() => setDialogOpen(true)}>
          Vincular
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted">Nenhum imóvel vinculado ainda.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) =>
            item.properties ? (
              <li key={item.target_id} className="flex items-center justify-between text-xs">
                <Link href={`/app/properties/${item.properties.id}`} className="hover:underline">
                  {item.properties.title}
                </Link>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-text-muted">
                    {formatBRL(item.properties.price_sale_cents ?? item.properties.price_rent_cents)}
                  </span>
                  <button
                    type="button"
                    onClick={() => unlink.mutate(item.properties!.id)}
                    aria-label="Desvincular"
                    className="text-text-muted hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ) : null,
          )}
        </ul>
      )}
      <LinkPropertyDialog leadId={leadId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </section>
  );
}
```

- [ ] **Step 4: `components/kanban/LinkPropertyDialog.tsx`** (busca imóvel pelo título e vincula — espelha `LinkLeadDialog` da Task 10)

```tsx
"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useLinkPropertyToLead } from "@/hooks/leads/useLeadInterestedProperties";

interface PropertySearchResult {
  id: string;
  title: string;
}

interface Props {
  leadId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function LinkPropertyDialog({ leadId, open, onOpenChange }: Props) {
  const [search, setSearch] = useState("");
  const link = useLinkPropertyToLead(leadId);

  const q = useQuery({
    queryKey: ["property-search", search],
    enabled: open && search.length >= 2,
    queryFn: async () =>
      apiClient.get<{ data: PropertySearchResult[] }>(
        `/api/v1/properties?search=${encodeURIComponent(search)}&limit=10`,
      ),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular imóvel</DialogTitle>
        </DialogHeader>
        <Input placeholder="Buscar imóvel pelo título..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {(q.data?.data ?? []).map((property) => (
            <button
              key={property.id}
              type="button"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => link.mutate(property.id, { onSuccess: () => onOpenChange(false) })}
            >
              <span>{property.title}</span>
              <Button size="sm" variant="ghost" disabled={link.isPending}>
                Vincular
              </Button>
            </button>
          ))}
          {search.length >= 2 && q.data?.data.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">Nenhum imóvel encontrado.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Integrar no `LeadDossier`**

Em `components/kanban/LeadDossier.tsx`, adicione o import e a seção **entre** `{/* ② timeline */}` e `{/* ③ campos, por último */}` (a ordem "o que aconteceu → interesses → editar" segue o mesmo princípio já documentado no cabeçalho do arquivo — dado novo entra perto do que já é lido primeiro, edição continua por último):

```tsx
import { LeadInterestedProperties } from "./LeadInterestedProperties";

// ... dentro do JSX, logo após o </section> da timeline (② timeline) e antes do
// <div ref={campos} ...> (③ campos):
<LeadInterestedProperties leadId={lead.id} />
```

- [ ] **Step 6: `pnpm typecheck && pnpm lint`**

Expected: sem erros.

- [ ] **Step 7: Rodar o dev server e conferir visualmente**

Run: `pnpm dev`, abrir o Kanban, clicar num lead pra abrir o `LeadDossier`, ver a seção "Imóveis de interesse", vincular um imóvel cadastrado na Task 9, confirmar que aparece ali **e** na lista de leads da tela de detalhe do imóvel (Task 10) — é o mesmo vínculo, as duas telas devem concordar.

- [ ] **Step 8: Commit**

```bash
git add "app/api/v1/leads/[id]/properties" hooks/leads/useLeadInterestedProperties.ts components/kanban/LeadInterestedProperties.tsx components/kanban/LinkPropertyDialog.tsx components/kanban/LeadDossier.tsx
git commit -m "feat(ui): seção 'Imóveis de interesse' no LeadDossier"
```

---

## Task 12: RBAC — testes de rejeição para `viewer` nas rotas de mutação

**Files:**
- Modify: `app/api/v1/properties/route.test.ts` (se algum caso já não cobrir)
- Modify: `app/api/v1/properties/[id]/route.test.ts`
- Modify: `app/api/v1/properties/[id]/media/route.test.ts`
- Modify: `app/api/v1/properties/[id]/leads/route.test.ts`

**Interfaces:**
- Consumes: mesmos mocks das Tasks 3-6.

- [ ] **Step 1: Conferir cobertura existente**

As Tasks 3, 4, 5 e 6 já escreveram, cada uma, pelo menos um teste "viewer → 403, nenhuma escrita" pra sua rota de mutação (`POST`/`PATCH`/`DELETE`). Rode a suíte inteira do módulo e confirme:

Run: `pnpm vitest run app/api/v1/properties`
Expected: todos os testes de 403 passam.

- [ ] **Step 2: Preencher qualquer lacuna**

Se `PATCH /api/v1/properties/[id]` (Task 4) não tiver um teste de 403 dedicado (o plano da Task 4 cobriu só `DELETE`), adicione a `app/api/v1/properties/[id]/route.test.ts`:

```ts
describe("PATCH /api/v1/properties/[id]", () => {
  it("viewer não consegue editar (403, nenhum update)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= agent.", 403, {}),
    } as never);
    const { supabase, updates } = makeDb({ id: PROP_ID, status: "available" });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { PATCH } = await import("./route");
    const req = new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ status: "reserved" }) });
    const res = await PATCH(req, ctx as never);
    expect(res.status).toBe(403);
    expect(updates).toEqual([]);
  });
});
```

- [ ] **Step 3: Rodar a suíte inteira de novo**

Run: `pnpm vitest run app/api/v1/properties "app/api/v1/leads/[id]/properties"`
Expected: PASS.

- [ ] **Step 4: `pnpm typecheck && pnpm lint`**

Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/properties
git commit -m "test(properties): cobre 403 de viewer em PATCH /api/v1/properties/[id]"
```

---

## Task 13: E2E Playwright — cadastrar imóvel, vincular a um lead, ver na timeline

**Files:**
- Create: `tests/e2e/properties.spec.ts`
- Modify: `docs/testing/user-journey-map.md`

**Interfaces:**
- Consumes: `login()`, `expectToast()`, `loadCreds()` (padrões já existentes em `tests/e2e/webhooks.spec.ts` — reusar, não duplicar).

- [ ] **Step 1: Escrever o spec**

```ts
// tests/e2e/properties.spec.ts
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const APP_URL = `http://localhost:${process.env.E2E_PORT ?? "3001"}`;
const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface Creds {
  password: string;
  users: { agent?: { email: string }; viewer?: { email: string } };
}
function loadCreds(): Creds {
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${APP_URL}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app\//);
}

async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text)).toBeVisible({ timeout: 15_000 });
}

test.describe("módulo de imóveis — fluxo completo", () => {
  test.setTimeout(180_000);
  test.use({ actionTimeout: 10_000 });

  test("agent cadastra imóvel, vincula a um lead existente, e viewer não vê botão de criar", async ({ page, browser }) => {
    const creds = loadCreds();
    const agentEmail = creds.users.agent?.email;
    if (!agentEmail) test.skip(true, "usuário agent de teste não seedado — ver scripts/seed-e2e-credentials.ts");

    const ts = Date.now();
    const title = `Casa E2E ${ts}`;
    let createdPropertyId: string | undefined;

    try {
      await login(page, agentEmail!, creds.password);

      // 1. Cadastrar imóvel
      await page.getByRole("link", { name: "Imóveis" }).click();
      await page.waitForURL(/\/app\/properties/);
      await page.getByRole("button", { name: "Novo imóvel" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.locator("#title").fill(title);

      const [createRes] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/v1/properties") && r.request().method() === "POST"),
        page.getByRole("button", { name: "Cadastrar imóvel" }).click(),
      ]);
      expect(createRes.ok()).toBeTruthy();
      const createBody = (await createRes.json()) as { data: { id: string } };
      createdPropertyId = createBody.data.id;

      await page.waitForURL(/\/app\/properties\/[^/]+$/);
      await expect(page.getByRole("heading", { name: title })).toBeVisible();

      // 2. Ir pro Kanban, abrir um lead qualquer, vincular o imóvel recém-criado
      await page.getByRole("link", { name: "Kanban" }).click();
      await page.waitForURL(/\/app\/kanban/);
      await page.locator("[data-lead-card]").first().click();
      await expect(page.getByText("Imóveis de interesse")).toBeVisible();
      await page.getByRole("button", { name: "Vincular" }).click();
      await page.getByPlaceholder("Buscar imóvel pelo título...").fill(title);
      await page.getByText(title, { exact: false }).first().click();
      await expect(page.getByText(title)).toBeVisible();

      // 3. Timeline do lead reflete o vínculo
      await expect(page.getByText(/imóvel vinculado/i)).toBeVisible({ timeout: 15_000 });

      // 4. viewer não vê botão de criar
      const viewerEmail = creds.users.viewer?.email;
      if (viewerEmail) {
        const viewerContext = await browser.newContext();
        const viewerPage = await viewerContext.newPage();
        await login(viewerPage, viewerEmail, creds.password);
        await viewerPage.getByRole("link", { name: "Imóveis" }).click();
        await viewerPage.waitForURL(/\/app\/properties/);
        await expect(viewerPage.getByRole("button", { name: "Novo imóvel" })).toHaveCount(0);
        await viewerContext.close();
      }
    } finally {
      if (createdPropertyId) {
        await page.request.delete(`${APP_URL}/api/v1/properties/${createdPropertyId}`).catch(() => undefined);
      }
    }
  });
});
```

Confira, antes de rodar, os seletores reais (`data-lead-card` no `KanbanCard.tsx`, texto exato do toast/atividade de vínculo criado na Task 6/11) — ajuste os seletores do spec pros que existem de fato no DOM, sem inventar `data-*` que a Task 9/10/11 não adicionaram. Se `KanbanCard.tsx` não expuser `data-lead-card`, use o seletor real (ex.: `page.locator(".kanban-card").first()` ou o `role`/texto que o componente já usa) e adicione um `data-testid="lead-card"` mínimo ao `KanbanCard.tsx` se nenhum seletor estável existir — mudança de 1 linha, não um redesenho.

- [ ] **Step 2: Rodar o spec contra o ambiente de E2E do repo**

Run: `pnpm test:e2e -- properties.spec.ts` (ou o comando equivalente documentado em `docs/testing/user-journey-map.md`/`README` de E2E — confirme o script exato em `package.json` antes de rodar).
Expected: PASS. Se falhar por seletor divergente, ajuste o spec (não a UI) até refletir o comportamento real — só mude a UI se o comportamento em si estiver errado.

- [ ] **Step 3: Capturar evidência visual**

Salve screenshot/trace da execução em `.superpowers/evidence/` (doutrina de QA Visual com Recursos Reais do CLAUDE.md) — Playwright já grava trace se `trace: 'on-first-retry'` estiver configurado em `playwright.config.ts`; se não, rode com `--trace on` uma vez pra gerar a evidência.

- [ ] **Step 4: Atualizar o mapa de jornadas**

Em `docs/testing/user-journey-map.md`, adicione uma entrada pra "Cadastrar imóvel e vincular a lead" (prioridade conforme o restante do documento — não é jornada de onboarding `[P0]`, é feature de uso corrente), referenciando `tests/e2e/properties.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/properties.spec.ts docs/testing/user-journey-map.md
git commit -m "test(e2e): fluxo completo de cadastro de imóvel + vínculo com lead"
```

---

## Task 14: Verificação final (Definition of Done)

**Files:** nenhum novo — só validação.

- [ ] **Step 1: Typecheck e lint completos**

Run: `pnpm typecheck && pnpm lint`
Expected: zero erros.

- [ ] **Step 2: Suíte unit completa**

Run: `pnpm test:unit`
Expected: PASS, incluindo todos os `.test.ts` criados nas Tasks 2-6, 11, 12.

- [ ] **Step 3: Suíte de invariantes (RLS + baseline install/update)**

Run: `pnpm test:db`
Expected: PASS, incluindo os testes de `properties`/`properties_media` adicionados na Task 1.

- [ ] **Step 4: E2E**

Run: o comando de E2E do repo (confirmar em `package.json`), no mínimo o spec da Task 13.
Expected: PASS.

- [ ] **Step 5: Conferir a checklist de Definition of Done do `CLAUDE.md` item a item**

RLS testada (Task 1) · audit emitido em toda mutação (Tasks 3-6) · rate limit — não aplicável, rotas exigem sessão autenticada, não são públicas · Zod valida todo input externo (Task 2-6) · sem `console.log` · env vars novas — nenhuma introduzida por este módulo · doc atualizada (spec já reflete o schema real, Task 1) · migration + MANIFEST (Task 1) · UI provada pela tela em ambiente real (Tasks 9-11, 13) · Living System Checklist (`docs/doctrine/sistema-vivo.md`) — o módulo tem entrada (formulário) e saída (listagem, detalhe, dossiê do lead), emite atividade (`crm_lead_activities` + `api_audit_log`), aparece na tela (sidebar), e o mapa vivo de arquitetura deveria ganhar a peça nova — **se `docs/architecture/` mantiver um diagrama vivo de módulos, adicione `properties` a ele nesta task; se não houver um diagrama que liste módulos individualmente, anote a decisão e pule.**

- [ ] **Step 6: Nenhum commit necessário neste task — é só verificação. Se algo falhar, volte à task correspondente, corrija, e re-rode a verificação.**
