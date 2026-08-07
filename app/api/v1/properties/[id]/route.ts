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
