/**
 * GET /api/v1/leads/[id]/properties — imóveis vinculados a este lead.
 *
 * Simétrico à Task 6 (`GET /api/v1/properties/[id]/leads`), mas query
 * diferente: `crm_lead_links` é indexado por (lead_id, target_kind,
 * target_id), então aqui filtramos por lead_id e projetamos o imóvel do
 * outro lado do vínculo. Somente leitura — vincular/desvincular reaproveita
 * as rotas já existentes (`POST`/`DELETE /api/v1/properties/[id]/leads*`),
 * não duplica escrita.
 *
 * DUAS queries, não um embed PostgREST (`properties(...)` dentro do
 * `.select()`). `crm_lead_links.target_id` é polimórfico (`target_kind` pode
 * ser 'order'/'conversation'/'lead'/'property'/...) e por isso **não tem, e
 * não pode ter, FK única pra `properties`** — só `lead_id` tem FK real
 * (`crm_lead_links_lead_id_fkey`, ver baseline.sql), que é o que faz o embed
 * simétrico (`crm_leads(id, title)` em `properties/[id]/leads/route.ts`)
 * funcionar. Tentar embutir `properties(...)` aqui SEMPRE falha em runtime
 * com PGRST200 ("Could not find a relationship between 'crm_lead_links' and
 * 'properties'") — confirmado rodando contra Postgres real (Task 14); os
 * mocks do teste unitário anterior não pegavam porque simulavam o retorno já
 * "resolvido", sem passar pelo PostgREST de verdade.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

interface PropertySummary {
  id: string;
  title: string;
  status: string;
  price_sale_cents: number | null;
  price_rent_cents: number | null;
}

export async function GET(_req: NextRequest | Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;
  const authz = await requireRole("viewer", { requestId, resource: "properties" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();

  const { data: links, error: linksError } = await supabase
    .from("crm_lead_links")
    .select("target_id, created_at")
    .eq("organization_id", activeOrg.orgId)
    .eq("lead_id", leadId)
    .eq("target_kind", "property")
    .eq("link_kind", "interested_in");
  if (linksError) return fail("internal_error", linksError.message, 500, { requestId });
  if (!links || links.length === 0) return ok([], { requestId });

  const rows = links as Array<{ target_id: string; created_at: string }>;
  const propertyIds = rows.map((l) => l.target_id);
  const { data: properties, error: propsError } = await supabase
    .from("properties")
    .select("id, title, status, price_sale_cents, price_rent_cents")
    .eq("organization_id", activeOrg.orgId)
    .in("id", propertyIds);
  if (propsError) return fail("internal_error", propsError.message, 500, { requestId });

  const byId = new Map(
    (properties as PropertySummary[] | null ?? []).map((p) => [p.id, p]),
  );
  const result = rows.map((l) => ({
    target_id: l.target_id,
    created_at: l.created_at,
    properties: byId.get(l.target_id) ?? null,
  }));

  return ok(result, { requestId });
}
