// @vitest-environment node
//
// Multipart real (File/FormData) precisa do realm do Node — jsdom (default do
// projeto) tem seu próprio File/FormData que corrompe o corpo ao passar pelo
// parser de multipart (ver app/api/v1/ai/skills/import/route.test.ts).
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
      single: async () => ({
        data: { id: "media-1", property_id: PROP_ID, storage_path: "x" },
        error: null,
      }),
    }),
  }));
  return { from: vi.fn(() => chain) };
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
    const uploadSpy = vi.fn(async (_path: string, _buf: Buffer, _opts: unknown) => ({ error: null }));
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

  it("404 quando o imóvel não pertence à org ativa", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    vi.mocked(createClient).mockResolvedValue(makeSupabase(false) as never);

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" }));
    const req = new Request("http://localhost", { method: "POST", body: form });

    const { POST } = await import("./route");
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(404);
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });

  it("rejeita mime não suportado com 415 e sem upload", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    vi.mocked(createClient).mockResolvedValue(makeSupabase(true) as never);

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "malware.exe", { type: "application/x-msdownload" }),
    );
    const req = new Request("http://localhost", { method: "POST", body: form });

    const { POST } = await import("./route");
    const res = await POST(req, ctx as never);
    expect(res.status).toBe(415);
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });
});
