/**
 * Proteção de telefone/e-mail em listContactsHandler/getContactHandler —
 * ver docs/superpowers/specs/2026-08-09-protecao-contato-corretor-design.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { listContactsHandler, getContactHandler } from "@/app/api/v1/contacts/_handler";
import type { HandlerCtx, Actor } from "@/lib/api/handlers/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const CRIADOR = "22222222-2222-4222-8222-222222222222";
const OUTRO_USER = "33333333-3333-4333-8333-333333333333";
const CONTACT_ID = "44444444-4444-4444-8444-444444444444";

function contactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTACT_ID,
    organization_id: ORG,
    created_by_user_id: CRIADOR,
    name: "Maria",
    display_name: null,
    email: "maria@example.com",
    email_normalized: "maria@example.com",
    phone_number: "+5531988887777",
    cpf_hash: null,
    birthdate: null,
    is_blocked: false,
    blocked_reason: null,
    is_anonymized: false,
    anonymized_at: null,
    is_merged_into: null,
    merged_at: null,
    consent: {},
    tags: [],
    source: "webhook",
    source_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    last_activity_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSupabase(rows: ReturnType<typeof contactRow>[]) {
  const client = {
    from(table: string) {
      if (table !== "contacts") throw new Error(`fake_supabase: tabela inesperada '${table}'`);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        or: () => builder,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: typeof rows; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

function ctxFor(actor: Actor): HandlerCtx {
  return { organization_id: ORG, actor, requestId: "req-1" };
}

describe("listContactsHandler — proteção de telefone/email", () => {
  it("agent que não cadastrou o contato recebe telefone/email nulos", async () => {
    const supabase = makeSupabase([contactRow()]);
    const result = await listContactsHandler(
      supabase,
      ctxFor({ type: "user", id: OUTRO_USER, role: "agent" }),
      { limit: 20 },
    );
    expect(result.contacts[0]).toMatchObject({
      phone_number: null,
      email: null,
      contact_protected: true,
    });
  });

  it("agent que cadastrou o próprio contato vê telefone/email normalmente", async () => {
    const supabase = makeSupabase([contactRow()]);
    const result = await listContactsHandler(
      supabase,
      ctxFor({ type: "user", id: CRIADOR, role: "agent" }),
      { limit: 20 },
    );
    expect(result.contacts[0]).toMatchObject({
      phone_number: "+5531988887777",
      email: "maria@example.com",
      contact_protected: false,
    });
  });

  it("manager vê telefone/email de qualquer contato", async () => {
    const supabase = makeSupabase([contactRow()]);
    const result = await listContactsHandler(
      supabase,
      ctxFor({ type: "user", id: OUTRO_USER, role: "manager" }),
      { limit: 20 },
    );
    expect(result.contacts[0]).toMatchObject({
      phone_number: "+5531988887777",
      contact_protected: false,
    });
  });
});

describe("getContactHandler — proteção de telefone/email", () => {
  it("agent que não cadastrou recebe dado protegido", async () => {
    const supabase = makeSupabase([contactRow()]);
    const result = await getContactHandler(
      supabase,
      ctxFor({ type: "user", id: OUTRO_USER, role: "agent" }),
      { contactId: CONTACT_ID },
    );
    expect(result.phone_number).toBeNull();
    expect(result.email).toBeNull();
    expect(result.contact_protected).toBe(true);
  });
});
