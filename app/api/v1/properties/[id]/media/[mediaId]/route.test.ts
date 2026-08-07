import { describe, it, expect, vi, beforeEach } from "vitest";
import { fail } from "@/lib/api/wrappers";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROP_ID = "33333333-3333-3333-3333-333333333333";
const MEDIA_ID = "44444444-4444-4444-4444-444444444444";
const STORAGE_PATH = `${ORG_ID}/${PROP_ID}/photo-abc.jpg`;
const USER = { id: "22222222-2222-2222-2222-222222222222" };
const ctx = { params: Promise.resolve({ id: PROP_ID, mediaId: MEDIA_ID }) };

beforeEach(() => vi.clearAllMocks());

function makeSupabase(mediaExists: boolean) {
  const deleteCalls: unknown[] = [];
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({
    data: mediaExists ? { id: MEDIA_ID, property_id: PROP_ID, storage_path: STORAGE_PATH } : null,
    error: null,
  }));
  chain.delete = vi.fn(() => {
    const deleteChain: Record<string, unknown> = {};
    deleteChain.eq = vi.fn((...args: unknown[]) => {
      deleteCalls.push(args);
      return deleteChain;
    });
    // Terminal await: the route awaits the `.eq().eq().eq()` chain directly
    // (no explicit terminal call) — resolve like the real Supabase builder.
    Object.assign(deleteChain, { then: (resolve: (v: unknown) => void) => resolve({ error: null }) });
    return deleteChain;
  });
  return { from: vi.fn(() => chain), deleteCalls };
}

describe("DELETE /api/v1/properties/[id]/media/[mediaId]", () => {
  it("storage.remove falhando não bloqueia a remoção da linha (204) e reporta no audit", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { from } = makeSupabase(true);
    vi.mocked(createClient).mockResolvedValue({ from } as never);
    const removeSpy = vi.fn(async (_paths: string[]) => ({ error: { message: "network blip" } }));
    vi.mocked(createAdminClient).mockReturnValue({
      storage: { from: () => ({ remove: removeSpy }) },
    } as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), ctx as never);

    expect(res.status).toBe(204);
    expect(removeSpy).toHaveBeenCalledWith([STORAGE_PATH]);
    const auditCall = vi.mocked(audit).mock.calls[0]?.[0] as { metadata?: Record<string, unknown> };
    expect(auditCall.metadata?.storage_remove_error).toBe("network blip");
  });

  it("storage.remove bem-sucedido: audit reporta storage_remove_error nulo", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { from } = makeSupabase(true);
    vi.mocked(createClient).mockResolvedValue({ from } as never);
    const removeSpy = vi.fn(async (_paths: string[]) => ({ error: null }));
    vi.mocked(createAdminClient).mockReturnValue({
      storage: { from: () => ({ remove: removeSpy }) },
    } as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), ctx as never);

    expect(res.status).toBe(204);
    const auditCall = vi.mocked(audit).mock.calls[0]?.[0] as { metadata?: Record<string, unknown> };
    expect(auditCall.metadata?.storage_remove_error).toBeNull();
  });

  it("404 quando a mídia não existe na org/imóvel ativos (sem chamar storage)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: USER,
      org: { orgId: ORG_ID, name: "Org", role: "agent" },
    } as never);
    const { from } = makeSupabase(false);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), ctx as never);

    expect(res.status).toBe(404);
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });

  it("viewer não consegue remover (403)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= agent.", 403, {}),
    } as never);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost"), ctx as never);

    expect(res.status).toBe(403);
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });
});
