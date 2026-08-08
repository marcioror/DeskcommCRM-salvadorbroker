-- 0139: módulo de imóveis (venda/locação) — tabelas properties/properties_media,
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
