/**
 * Proteção de telefone/e-mail em listContactsHandler/getContactHandler —
 * ver docs/superpowers/specs/2026-08-09-protecao-contato-corretor-design.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { listContactsHandler, getContactHandler, createContactHandler } from "@/app/api/v1/contacts/_handler";
import { patchContactHandler } from "@/app/api/v1/contacts/_handler";
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
    // C1: `email_normalized` é o MESMO e-mail em outra coluna (gerada por
    // `lower(trim(email))`) — `toMatchObject` acima não pega porque não lista a
    // chave. Asserção de valor explícita, senão o e-mail protegido continua
    // vazando por aqui mesmo com o teste verde.
    expect(result.contacts[0]?.email_normalized).toBeNull();
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
    // C1: mesma checagem explícita de email_normalized no getContactHandler.
    expect(result.email_normalized).toBeNull();
  });
});

function makeSupabaseForPatch(existingRow: Record<string, unknown>, updatedRow: Record<string, unknown>) {
  const client = {
    from(table: string) {
      if (table !== "contacts") throw new Error(`fake_supabase: tabela inesperada '${table}'`);
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({ maybeSingle: async () => ({ data: updatedRow, error: null }) }),
          }),
        }),
      };
    },
    rpc: async () => ({ error: null }),
  };
  return client as unknown as SupabaseClient;
}

describe("patchContactHandler — proteção de telefone/email", () => {
  it("agent que não cadastrou o contato NÃO pode alterar phone_number/email (403 contact_protected)", async () => {
    const existing = { id: CONTACT_ID, organization_id: ORG, created_by_user_id: CRIADOR, is_anonymized: false, tags: [], email: "maria@example.com", phone_number: "+5531988887777", name: "Maria", display_name: null, consent: {} };
    const supabase = makeSupabaseForPatch(existing, contactRow());
    await expect(
      patchContactHandler(
        supabase,
        ctxFor({ type: "user", id: OUTRO_USER, role: "agent" }),
        CONTACT_ID,
        { phone_number: "+5531900000000" },
      ),
    ).rejects.toMatchObject({ status: 403, code: "contact_protected" });
  });

  it("agent que cadastrou o próprio contato PODE alterar phone_number", async () => {
    const existing = { id: CONTACT_ID, organization_id: ORG, created_by_user_id: CRIADOR, is_anonymized: false, tags: [], email: "maria@example.com", phone_number: "+5531988887777", name: "Maria", display_name: null, consent: {} };
    const supabase = makeSupabaseForPatch(existing, contactRow({ phone_number: "+5531900000000" }));
    const result = await patchContactHandler(
      supabase,
      ctxFor({ type: "user", id: CRIADOR, role: "agent" }),
      CONTACT_ID,
      { phone_number: "+5531900000000" },
    );
    expect(result.phone_number).toBe("+5531900000000");
  });

  it("editar só as tags (sem tocar phone/email) não é bloqueado mesmo sem ser o criador", async () => {
    const existing = { id: CONTACT_ID, organization_id: ORG, created_by_user_id: CRIADOR, is_anonymized: false, tags: [], email: "maria@example.com", phone_number: "+5531988887777", name: "Maria", display_name: null, consent: {} };
    const supabase = makeSupabaseForPatch(existing, contactRow({ tags: ["quente"] }));
    const result = await patchContactHandler(
      supabase,
      ctxFor({ type: "user", id: OUTRO_USER, role: "agent" }),
      CONTACT_ID,
      { tags: ["quente"] },
    );
    expect(result.tags).toEqual(["quente"]);
    // A resposta do PATCH também vem protegida: sem isto, um PATCH inofensivo
    // (só tags) devolveria telefone/email reais de um contato que este ator
    // não cadastrou — a porta dos fundos que esta task existe para fechar.
    expect(result.phone_number).toBeNull();
    expect(result.email).toBeNull();
    expect(result.contact_protected).toBe(true);
  });
});

function makeSupabaseForCreate(insertedRow: Record<string, unknown>) {
  const client = {
    from(table: string) {
      if (table !== "contacts") throw new Error(`fake_supabase: tabela inesperada '${table}'`);
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({ data: insertedRow, error: null }),
          }),
        }),
      };
    },
    rpc: async () => ({ error: null }),
  };
  return client as unknown as SupabaseClient;
}

describe("createContactHandler — proteção de telefone/email", () => {
  it("agent criando um contato recebe phone_number/email reais (contrato cotidiano: é o criador)", async () => {
    const created = contactRow({ created_by_user_id: CRIADOR });
    const supabase = makeSupabaseForCreate(created);
    const result = await createContactHandler(
      supabase,
      ctxFor({ type: "user", id: CRIADOR, role: "agent" }),
      { name: "Maria", email: "maria@example.com", phone_number: "+5531988887777", source: "webhook" },
    );
    expect(result.contact.phone_number).toBe("+5531988887777");
    expect(result.contact.email).toBe("maria@example.com");
    expect(result.contact.contact_protected).toBe(false);
  });

  it("forward-guard: se um fluxo futuro grava created_by_user_id diferente do ator, o retorno é protegido", async () => {
    // Hoje, createContactHandler sempre grava created_by_user_id = ator.id, então este estado não existe.
    // O teste existe para o dia em que um fluxo de atribuição/importação/migração parar de fazer isso —
    // a proteção já tem de estar de pé nesse dia, e sem este teste ninguém perceberia que ela sumiu.
    const created = contactRow({ created_by_user_id: CRIADOR });
    const supabase = makeSupabaseForCreate(created);
    const result = await createContactHandler(
      supabase,
      ctxFor({ type: "user", id: OUTRO_USER, role: "agent" }),
      { name: "Maria", email: "maria@example.com", phone_number: "+5531988887777", source: "webhook" },
    );
    expect(result.contact.phone_number).toBeNull();
    expect(result.contact.email).toBeNull();
    expect(result.contact.contact_protected).toBe(true);
  });
});
