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
import { buildLeadActivityRow } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
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

  const { data: property, error: propErr } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (propErr) return fail("internal_error", propErr.message, 500, { requestId });
  if (!property) return fail("property_not_found", "Imóvel não encontrado.", 404, { requestId });

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
    .select("id, title")
    .eq("id", propertyId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (propErr) return fail("internal_error", propErr.message, 500, { requestId });
  if (!property) return fail("property_not_found", "Imóvel não encontrado.", 404, { requestId });

  const { data: lead, error: leadErr } = await supabase
    .from("crm_leads")
    .select("id, title, contact_id")
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
  if (existingLink) {
    return fail("duplicate_lead_link", "Este lead já está vinculado a este imóvel.", 409, { requestId });
  }

  const { data: link, error: insErr } = await supabase
    .from("crm_lead_links")
    .insert({
      organization_id: activeOrg.orgId,
      lead_id: leadId,
      target_kind: "property",
      target_id: propertyId,
      link_kind: "interested_in",
      created_by_user_id: user.id,
    })
    .select("*")
    .single();
  if (insErr || !link) return fail("internal_error", insErr?.message ?? "link_insert_failed", 500, { requestId });

  // Rastro de uma mutação JÁ OCORRIDA (o vínculo já existe) — falha aqui é
  // BAIXA por doutrina (lib/leads/activity-write-failure.ts): não desfaz o
  // vínculo criado, mas não pode falhar em silêncio (vira aviso em event_log).
  const { error: activityErr } = await supabase.from("crm_lead_activities").insert(
    buildLeadActivityRow({
      organizationId: activeOrg.orgId,
      leadId,
      contactId: lead.contact_id ?? null,
      type: "property_linked",
      sourceModule: "properties",
      sourceId: propertyId,
      actor: { type: "user", id: user.id },
      reason: `Vinculado ao imóvel «${property.title ?? propertyId}»`,
      payload: { property_id: propertyId, lead_link_id: link.id },
    }),
  );
  if (activityErr) {
    await registraFalhaDeAtividade(supabase, {
      organizationId: activeOrg.orgId,
      leadId,
      tipo: "property_linked",
      origem: `properties/${propertyId}/leads POST`,
      erro: activityErr.message,
      requestId,
    });
  }

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
