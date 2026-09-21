/** DELETE /api/v1/properties/[id]/leads/[leadId] — desvincula (remove crm_lead_links + registra atividade). */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, noContent } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { buildLeadActivityRow } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
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

  // Não é preciso checar `crm_leads` separadamente: `crm_lead_links.lead_id`
  // tem FK `ON DELETE CASCADE` (baseline.sql) — se o lead sumiu, o vínculo já
  // sumiu junto, e o lookup abaixo (com organization_id explícito) já cobre
  // os dois casos com um único código de erro (`not_found`).
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

  const { error: delErr } = await supabase
    .from("crm_lead_links")
    .delete()
    .eq("id", link.id)
    .eq("organization_id", activeOrg.orgId);
  if (delErr) return fail("internal_error", delErr.message, 500, { requestId });

  // Rastro de uma mutação JÁ OCORRIDA (o vínculo já foi removido) — falha
  // aqui é BAIXA por doutrina (lib/leads/activity-write-failure.ts).
  const { error: activityErr } = await supabase.from("crm_lead_activities").insert(
    buildLeadActivityRow({
      organizationId: activeOrg.orgId,
      leadId,
      type: "property_unlinked",
      sourceModule: "properties",
      sourceId: propertyId,
      actor: { type: "user", id: user.id },
      reason: `Desvinculado do imóvel ${propertyId}`,
      payload: { property_id: propertyId },
    }),
  );
  if (activityErr) {
    await registraFalhaDeAtividade(supabase, {
      organizationId: activeOrg.orgId,
      leadId,
      tipo: "property_unlinked",
      origem: `properties/${propertyId}/leads/${leadId} DELETE`,
      erro: activityErr.message,
      requestId,
    });
  }

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
