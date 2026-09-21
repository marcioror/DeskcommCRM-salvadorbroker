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
