/** POST /api/v1/properties/[id]/media — upload de foto (buffered, storage-first). */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extFromMime, MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
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

  // Guard de DoS: rejeita pelo Content-Length declarado ANTES de bufferizar
  // o corpo inteiro (mesmo padrão de conversations/[id]/media).
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_MEDIA_BYTES + 1_048_576) {
    return fail("payload_too_large", "Arquivo acima de 50MB.", 413, { requestId });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", "Arquivo 'file' obrigatório.", 422, { requestId });
  }

  const mime = file.type || "application/octet-stream";
  const verdict = validateOutboundMedia(mime, file.size);
  if (!verdict.ok) {
    const status = verdict.code === "payload_too_large" ? 413 : verdict.code === "unsupported_media_type" ? 415 : 422;
    return fail(verdict.code, verdict.message, status, { requestId });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${activeOrg.orgId}/${propertyId}/photo-${randomUUID()}.${extFromMime(mime)}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from("property-media")
    .upload(storagePath, buffer, { contentType: mime, upsert: false });
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
    // O blob já subiu pro bucket antes do insert falhar — sem limpeza fica
    // órfão (ninguém aponta pra `storagePath`). Best-effort, fire-and-forget:
    // uma falha na limpeza não deve segurar a resposta de erro já em curso
    // (mesmo espírito do `audit()` — não deixar falha secundária bloquear o
    // fluxo principal), mas loga se a limpeza também falhar.
    void admin.storage
      .from("property-media")
      .remove([storagePath])
      .then(({ error: cleanupErr }) => {
        if (cleanupErr) {
          console.error("[properties.media] cleanup after insert failure failed", {
            storagePath,
            error: cleanupErr.message,
          });
        }
      });
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
