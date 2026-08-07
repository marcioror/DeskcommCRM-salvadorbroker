/**
 * GET /api/v1/leads/[id]/properties — imóveis vinculados a este lead.
 *
 * Simétrico à Task 6 (`GET /api/v1/properties/[id]/leads`), mas query
 * diferente: `crm_lead_links` é indexado por (lead_id, target_kind,
 * target_id), então aqui filtramos por lead_id e projetamos o imóvel do
 * outro lado do vínculo. Somente leitura — vincular/desvincular reaproveita
 * as rotas já existentes (`POST`/`DELETE /api/v1/properties/[id]/leads*`),
 * não duplica escrita.
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
