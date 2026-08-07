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

async function loadMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  mediaId: string,
  orgId: string,
) {
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

  // Filtro explícito de organization_id (+ property_id) no próprio DELETE,
  // não só no SELECT de existência que o precede — doutrina anti-pattern 10
  // (service role sem filtro manual) e lição da Task 4 (update/delete/insert
  // devem carregar o filtro, não só a checagem prévia).
  const { error: delErr } = await supabase
    .from("properties_media")
    .delete()
    .eq("id", mediaId)
    .eq("property_id", propertyId)
    .eq("organization_id", activeOrg.orgId);
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
