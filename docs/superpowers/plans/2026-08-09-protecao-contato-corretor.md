# Proteção de telefone/e-mail do lead para corretores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide a contact's `phone_number`/`email` from any team member who isn't the contact's creator (`viewer`/`agent` roles), while `manager`/`admin` always see everything and the autonomous WhatsApp bot keeps working unaffected.

**Architecture:** A single pure module (`lib/contacts/visibility.ts`) decides visibility from `(actor, contact.created_by_user_id)`. It is applied at the two read chokepoints that already exist — `app/api/v1/contacts/_handler.ts` and `app/api/v1/conversations/_handler.ts` — so every UI surface, the MCP tools, and any future consumer inherit the protection automatically. A companion guard in `patchContactHandler` blocks a non-owner from overwriting the protected fields via a direct API call (closing the write-side loophole the read-side fix would otherwise leave open).

**Tech Stack:** Next.js Route Handlers, Supabase (no schema change), Vitest (`pnpm test:unit`), TypeScript strict.

## Global Constraints

- No DB migration: `contacts.created_by_user_id` already exists, nullable, correctly populated by both contact-creation paths (verified in the spec).
- `manager`/`admin` always see phone/email, no exceptions.
- `viewer`/`agent` see phone/email only for contacts they personally created (`created_by_user_id === actor.id`).
- Non-human actors (`ai_agent`, `webhook_source` — includes the autonomous WhatsApp bot and any MCP/API-token caller) are **never** masked. Confirmed safe: outbound WhatsApp sending (`app/api/v1/messages/_handler.ts`) resolves the phone via its own independent query, never through the handlers this plan touches.
- Masked value is `null`, never partially redacted. UI shows a "Protegido" badge, not a blank field.
- Platform-admin cross-tenant inbox (`app/admin/(protected)/inbox/`, `hooks/useAdminInbox.ts`) is explicitly **out of scope** — different actor category (platform operator, not an org role), unrelated to this feature.
- Spec: `docs/superpowers/specs/2026-08-09-protecao-contato-corretor-design.md`.

---

### Task 1: Core visibility helper

**Files:**
- Create: `lib/contacts/visibility.ts`
- Test: `tests/unit/contacts-visibilidade.test.ts`

**Interfaces:**
- Produces: `podeVerContatoSensivel(actor: Actor, contactCreatedByUserId: string | null): boolean`
- Produces: `protegerContato<T extends { created_by_user_id: string | null; phone_number: string | null; email: string | null }>(contact: T, actor: Actor): T & { contact_protected: boolean }`
- Produces: `protegerTelefoneDoContatoEmbutido<T extends { created_by_user_id: string | null; phone_number: string | null }>(contact: T, actor: Actor): T & { contact_protected: boolean }`
- Consumes: `Actor` type from `@/lib/api/handlers/types`, `ROLE_RANK`/`Role` from `@/lib/auth/types`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/contacts-visibilidade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  podeVerContatoSensivel,
  protegerContato,
  protegerTelefoneDoContatoEmbutido,
} from "@/lib/contacts/visibility";
import type { Actor } from "@/lib/api/handlers/types";

const CRIADOR = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

function userActor(role: string, id: string = OUTRO): Actor {
  return { type: "user", id, role };
}

describe("podeVerContatoSensivel", () => {
  it("viewer vê só o que ele mesmo cadastrou", () => {
    expect(podeVerContatoSensivel(userActor("viewer", CRIADOR), CRIADOR)).toBe(true);
    expect(podeVerContatoSensivel(userActor("viewer", OUTRO), CRIADOR)).toBe(false);
  });

  it("agent vê só o que ele mesmo cadastrou", () => {
    expect(podeVerContatoSensivel(userActor("agent", CRIADOR), CRIADOR)).toBe(true);
    expect(podeVerContatoSensivel(userActor("agent", OUTRO), CRIADOR)).toBe(false);
  });

  it("manager e admin sempre veem, mesmo sem ter cadastrado", () => {
    expect(podeVerContatoSensivel(userActor("manager", OUTRO), CRIADOR)).toBe(true);
    expect(podeVerContatoSensivel(userActor("admin", OUTRO), CRIADOR)).toBe(true);
  });

  it("contato sem criador (entrou sozinho pela imobiliária) fica protegido pra viewer/agent, visível pra manager+", () => {
    expect(podeVerContatoSensivel(userActor("agent"), null)).toBe(false);
    expect(podeVerContatoSensivel(userActor("manager"), null)).toBe(true);
  });

  it("agente de IA e webhook nunca são bloqueados", () => {
    const iaActor: Actor = { type: "ai_agent", id: "run-1", role: "ai_operator" };
    const webhookActor: Actor = { type: "webhook_source", id: "src-1" };
    expect(podeVerContatoSensivel(iaActor, null)).toBe(true);
    expect(podeVerContatoSensivel(iaActor, CRIADOR)).toBe(true);
    expect(podeVerContatoSensivel(webhookActor, null)).toBe(true);
  });
});

describe("protegerContato", () => {
  it("oculta telefone e email quando protegido", () => {
    const c = protegerContato(
      { created_by_user_id: CRIADOR, phone_number: "+5531988887777", email: "a@b.com" },
      userActor("agent", OUTRO),
    );
    expect(c).toEqual({
      created_by_user_id: CRIADOR,
      phone_number: null,
      email: null,
      contact_protected: true,
    });
  });

  it("mantém telefone e email quando visível", () => {
    const c = protegerContato(
      { created_by_user_id: CRIADOR, phone_number: "+5531988887777", email: "a@b.com" },
      userActor("agent", CRIADOR),
    );
    expect(c).toEqual({
      created_by_user_id: CRIADOR,
      phone_number: "+5531988887777",
      email: "a@b.com",
      contact_protected: false,
    });
  });
});

describe("protegerTelefoneDoContatoEmbutido", () => {
  it("oculta só o telefone (formato embutido não tem email)", () => {
    const c = protegerTelefoneDoContatoEmbutido(
      { created_by_user_id: null, phone_number: "+5531988887777" },
      userActor("viewer", OUTRO),
    );
    expect(c).toEqual({ created_by_user_id: null, phone_number: null, contact_protected: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/contacts-visibilidade.test.ts`
Expected: FAIL with "Cannot find module '@/lib/contacts/visibility'"

- [ ] **Step 3: Write the implementation**

Create `lib/contacts/visibility.ts`:

```ts
/**
 * Proteção de telefone/e-mail do lead: só quem cadastrou o contato (ou
 * gerente/admin) enxerga o dado bruto. Corretor atende pelo chat do CRM sem
 * nunca ver o número.
 *
 * Ver docs/superpowers/specs/2026-08-09-protecao-contato-corretor-design.md.
 */
import type { Actor } from "@/lib/api/handlers/types";
import { ROLE_RANK, type Role } from "@/lib/auth/types";

/**
 * Só atores humanos (`type: "user"`) são avaliados por regra de cadastro —
 * o agente de IA autônomo e chamadas de webhook nunca são um corretor tentando
 * "levar" o cliente, e o bot PRECISA do número real para mandar mensagem
 * (que ele resolve por um caminho totalmente separado, sem passar por aqui).
 */
export function podeVerContatoSensivel(
  actor: Actor,
  contactCreatedByUserId: string | null,
): boolean {
  if (actor.type !== "user") return true;
  const rank = actor.role ? (ROLE_RANK[actor.role as Role] ?? 0) : 0;
  if (rank >= ROLE_RANK.manager) return true;
  return contactCreatedByUserId !== null && contactCreatedByUserId === actor.id;
}

interface ContatoComTelefone {
  created_by_user_id: string | null;
  phone_number: string | null;
}

interface ContatoComTelefoneEEmail extends ContatoComTelefone {
  email: string | null;
}

/** Contato completo (API /contacts, MCP) — protege telefone E e-mail. */
export function protegerContato<T extends ContatoComTelefoneEEmail>(
  contact: T,
  actor: Actor,
): T & { contact_protected: boolean } {
  if (podeVerContatoSensivel(actor, contact.created_by_user_id)) {
    return { ...contact, contact_protected: false };
  }
  return { ...contact, phone_number: null, email: null, contact_protected: true };
}

/** Contato embutido em conversas — só telefone (esse formato não seleciona email). */
export function protegerTelefoneDoContatoEmbutido<T extends ContatoComTelefone>(
  contact: T,
  actor: Actor,
): T & { contact_protected: boolean } {
  if (podeVerContatoSensivel(actor, contact.created_by_user_id)) {
    return { ...contact, contact_protected: false };
  }
  return { ...contact, phone_number: null, contact_protected: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/contacts-visibilidade.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/contacts/visibility.ts tests/unit/contacts-visibilidade.test.ts
git commit -m "feat(contatos): regra pura de proteção de telefone/email por criador"
```

---

### Task 2: Novo código de erro `contact_protected`

**Files:**
- Modify: `lib/api/errors.ts:25-28`

**Interfaces:**
- Produces: `ApiErrorCodes.contact_protected` (used by Task 4).

- [ ] **Step 1: Edit the 403 section**

In `lib/api/errors.ts`, change:

```ts
  // 403 — authz
  forbidden: "forbidden",
  forbidden_role: "forbidden_role",
  forbidden_tenant: "forbidden_tenant",
  lgpd_anonymization_irreversible: "lgpd_anonymization_irreversible",
```

to:

```ts
  // 403 — authz
  forbidden: "forbidden",
  forbidden_role: "forbidden_role",
  forbidden_tenant: "forbidden_tenant",
  lgpd_anonymization_irreversible: "lgpd_anonymization_irreversible",
  contact_protected: "contact_protected", // ator não cadastrou este contato — telefone/email protegidos (não editáveis por ele)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep errors.ts`
Expected: no output (no errors introduced)

- [ ] **Step 3: Commit**

```bash
git add lib/api/errors.ts
git commit -m "feat(api): código de erro contact_protected"
```

---

### Task 3: Aplicar proteção em `contacts/_handler.ts` (list/get/create)

**Files:**
- Modify: `lib/types/contacts.ts:5-27` (add `created_by_user_id`, `contact_protected` to `Contact`)
- Modify: `app/api/v1/contacts/_handler.ts:23-24` (SELECT_COLS), and the `list`/`get`/`create` functions
- Test: `tests/unit/contacts-handler-protecao.test.ts`

**Interfaces:**
- Consumes: `protegerContato` from Task 1 (`@/lib/contacts/visibility`).
- Produces: every `Contact` returned by `listContactsHandler`/`getContactHandler`/`createContactHandler` now always carries `contact_protected: boolean` and (masked or real) `created_by_user_id`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/contacts-handler-protecao.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/contacts-handler-protecao.test.ts`
Expected: FAIL — `created_by_user_id` not selected, `contact_protected` undefined (assertions fail).

- [ ] **Step 3: Extend the `Contact` type**

In `lib/types/contacts.ts`, change:

```ts
export interface Contact {
  id: string;
  organization_id: string;
  name: string | null;
```

to:

```ts
export interface Contact {
  id: string;
  organization_id: string;
  /** Quem cadastrou este contato — null quando entrou sozinho (webhook/IA). */
  created_by_user_id: string | null;
  name: string | null;
```

and, in the same interface, after `last_activity_at: string | null;`, add:

```ts
  /** true quando phone_number/email vieram nulos por proteção (ver lib/contacts/visibility.ts). */
  contact_protected: boolean;
```

- [ ] **Step 4: Wire the protection into the handler**

In `app/api/v1/contacts/_handler.ts`:

Add the import (near the top, with the other `@/lib/...` imports):

```ts
import { protegerContato } from "@/lib/contacts/visibility";
```

Change `SELECT_COLS`:

```ts
const SELECT_COLS =
  "id, organization_id, name, display_name, email, email_normalized, phone_number, cpf_hash, birthdate, is_blocked, blocked_reason, is_anonymized, anonymized_at, is_merged_into, merged_at, consent, tags, source, source_metadata, created_at, updated_at, last_activity_at";
```

to:

```ts
const SELECT_COLS =
  "id, organization_id, created_by_user_id, name, display_name, email, email_normalized, phone_number, cpf_hash, birthdate, is_blocked, blocked_reason, is_anonymized, anonymized_at, is_merged_into, merged_at, consent, tags, source, source_metadata, created_at, updated_at, last_activity_at";
```

In `listContactsHandler`, change:

```ts
  const rows = (data ?? []) as Contact[];
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
```

to:

```ts
  const rows = (data ?? []) as Contact[];
  const protegidos = rows.map((r) => protegerContato(r, ctx.actor));
  const hasMore = protegidos.length > q.limit;
  const page = hasMore ? protegidos.slice(0, q.limit) : protegidos;
```

(the `last`/cursor lines right after stay as-is — they already read from `page`, which now comes from `protegidos`)

In `getContactHandler`, change:

```ts
  const contact = data as Contact;

  let cpfDecrypted: string | null = null;
```

to:

```ts
  const contact = data as Contact;
  const protegido = protegerContato(contact, ctx.actor);

  let cpfDecrypted: string | null = null;
```

and change the final return:

```ts
  return {
    ...contact,
    cpf_available: !!contact.cpf_hash,
    cpf_decrypted: cpfDecrypted,
    cpf_decrypt_denied: cpfDecryptDenied || undefined,
  };
```

to:

```ts
  return {
    ...protegido,
    cpf_available: !!contact.cpf_hash,
    cpf_decrypted: cpfDecrypted,
    cpf_decrypt_denied: cpfDecryptDenied || undefined,
  };
```

(the CPF gate logic in between keeps reading `contact`, unaffected — only the final shape changes)

In `createContactHandler`, change the return:

```ts
  return { contact, action: "created" };
```

to:

```ts
  return { contact: protegerContato(contact, ctx.actor), action: "created" };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/contacts-handler-protecao.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no new errors. If `createContactHandler`'s `CreateContactResult.contact` or any other call site complains about the extra `created_by_user_id`/`contact_protected` fields, it's because some other file constructs a `Contact`-shaped literal by hand (e.g. a test fixture) — add the two fields there too.

- [ ] **Step 7: Commit**

```bash
git add lib/types/contacts.ts app/api/v1/contacts/_handler.ts tests/unit/contacts-handler-protecao.test.ts
git commit -m "feat(contatos): protege telefone/email em list/get/create de contatos"
```

---

### Task 4: Bloquear edição de telefone/email por quem não pode ver

**Files:**
- Modify: `app/api/v1/contacts/_handler.ts` (`patchContactHandler`)
- Test: `tests/unit/contacts-handler-protecao.test.ts` (extend)
- Fix (collateral): `tests/unit/contato-audit-from-to.test.ts` — its fake contact
  has no `created_by_user_id`, so the new guard turns its `email`/`phone_number`
  patches into 403 and the file goes red. In its `beforeEach`, add
  `created_by_user_id: USUARIO` to the `estadoAtual` object (that test's actor
  IS the creator — the field was simply absent before this feature existed).
  Verified NOT affected, do not touch: `tests/invariants/contato-consent-e-auditoria.test.ts`
  and `tests/invariants/webhooks-trigger-events.test.ts` patch only
  `consent`/`tags`, which the guard ignores.

**Interfaces:**
- Consumes: `podeVerContatoSensivel` from Task 1.

Sem esta trava, o corretor não consegue LER o telefone protegido mas ainda
poderia SOBRESCREVER com `PATCH /api/v1/contacts/{id}` direto na API — trocando
o número real por um que ele controla, sem passar pela tela.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/contacts-handler-protecao.test.ts`:

```ts
import { patchContactHandler } from "@/app/api/v1/contacts/_handler";

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
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/contacts-handler-protecao.test.ts`
Expected: FAIL — no guard yet, the PATCH with `OUTRO_USER` succeeds instead of throwing 403.

- [ ] **Step 3: Implement the guard**

In `app/api/v1/contacts/_handler.ts`, add `podeVerContatoSensivel` to the existing visibility import:

```ts
import { podeVerContatoSensivel, protegerContato } from "@/lib/contacts/visibility";
```

Change the `existing` select in `patchContactHandler`:

```ts
    .select("id, organization_id, is_anonymized, tags, email, phone_number, name, display_name, consent")
```

to:

```ts
    .select("id, organization_id, created_by_user_id, is_anonymized, tags, email, phone_number, name, display_name, consent")
```

Right after the `is_anonymized` 403 block (before `const patch: Record<string, unknown> = {};`), insert:

```ts
  if (
    (input.email !== undefined || input.phone_number !== undefined) &&
    !podeVerContatoSensivel(
      ctx.actor,
      (existing as { created_by_user_id: string | null }).created_by_user_id,
    )
  ) {
    throw new ApiError(
      403,
      "contact_protected",
      undefined,
      ctx.requestId,
      "Você não cadastrou este contato — telefone e e-mail são protegidos.",
    );
  }
```

Change the final return:

```ts
  return contact;
}
```

to:

```ts
  return protegerContato(contact, ctx.actor);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/contacts-handler-protecao.test.ts`
Expected: PASS (7 tests total)

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/contacts/_handler.ts tests/unit/contacts-handler-protecao.test.ts
git commit -m "feat(contatos): bloqueia edição de telefone/email por quem não cadastrou"
```

---

### Task 5: Popular `actor.role` nas rotas REST de contatos

**Files:**
- Modify: `app/api/v1/contacts/route.ts:52-63` (GET)
- Modify: `app/api/v1/contacts/[id]/route.ts:36-52` (GET), `:92-99` (PATCH)

Sem isso, Tasks 3–4 nunca enxergam o role do ator numa chamada REST real —
`ctx.actor.role` fica `undefined`, e a checagem de rank cai sempre no "não
autorizado" (rank 0), protegendo até quem deveria ver. Este task é o que liga
o fio que já existe (`resolveActiveOrg`/`requireRole` já calculam o role, só
não o repassavam ao handler).

**Interfaces:**
- Consumes: `activeOrg.role` (já existe em `ActiveOrg`, `lib/auth/types.ts`).

- [ ] **Step 1: `app/api/v1/contacts/route.ts` — GET**

Change:

```ts
  const authUser = await loadAuthUser();
  const orgId = authUser ? (await resolveActiveOrg(authUser))?.orgId : undefined;

  try {
    const { contacts, cursor, has_more } = await listContactsHandler(
      supabase,
      {
        organization_id: orgId ?? "",
        actor: { type: "user", id: user.id },
        requestId,
      },
      qsParsed.data,
    );
```

to:

```ts
  const authUser = await loadAuthUser();
  const activeOrg = authUser ? await resolveActiveOrg(authUser) : null;

  try {
    const { contacts, cursor, has_more } = await listContactsHandler(
      supabase,
      {
        organization_id: activeOrg?.orgId ?? "",
        actor: { type: "user", id: user.id, role: activeOrg?.role },
        requestId,
      },
      qsParsed.data,
    );
```

- [ ] **Step 2: `app/api/v1/contacts/[id]/route.ts` — GET**

Change:

```ts
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      { contactId: id, decryptPurpose },
```

to:

```ts
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id, role: activeOrg.role },
        requestId,
      },
      { contactId: id, decryptPurpose },
```

- [ ] **Step 3: `app/api/v1/contacts/[id]/route.ts` — PATCH**

Change:

```ts
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      id,
      input,
```

to:

```ts
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id, role: activeOrg.role },
        requestId,
      },
      id,
      input,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/contacts/route.ts "app/api/v1/contacts/[id]/route.ts"
git commit -m "fix(contatos): repassa o role do ator pro handler (necessário pra proteção de telefone/email)"
```

---

### Task 6: Aplicar proteção no contato embutido em conversas

**Files:**
- Modify: `app/api/v1/conversations/_handler.ts:20-27` (SELECT_COLS), `listConversationsHandler`, `getConversationHandler`, `patchConversationHandler`
- Test: `tests/unit/conversations-handler-protecao.test.ts`

**Interfaces:**
- Consumes: `protegerTelefoneDoContatoEmbutido` from Task 1.
- Produces: local type `ConversationComContato` (= `Conversation & { contacts?: {...} | null }`) used by the three handlers.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/conversations-handler-protecao.test.ts`:

```ts
/**
 * Proteção de telefone no contato embutido em conversas — ver
 * docs/superpowers/specs/2026-08-09-protecao-contato-corretor-design.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { listConversationsHandler, getConversationHandler } from "@/app/api/v1/conversations/_handler";
import type { HandlerCtx, Actor } from "@/lib/api/handlers/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const CRIADOR = "22222222-2222-4222-8222-222222222222";
const OUTRO_USER = "33333333-3333-4333-8333-333333333333";
const CONV_ID = "44444444-4444-4444-8444-444444444444";

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONV_ID,
    organization_id: ORG,
    contact_id: "contact-1",
    channel_session_id: "session-1",
    channel: "whatsapp",
    status: "open",
    status_changed_at: "2026-01-01T00:00:00Z",
    assigned_to_user_id: null,
    assignee_kind: null,
    assigned_at: null,
    last_inbound_at: "2026-01-01T00:00:00Z",
    last_outbound_at: null,
    last_message_at: "2026-01-01T00:00:00Z",
    last_message_preview: "oi",
    unread_count_for_assignee: 0,
    is_group: false,
    group_chat_id: null,
    tags: [],
    metadata: {},
    snooze_until: null,
    bot_silenced_until: null,
    last_handoff_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    contacts: {
      id: "contact-1",
      display_name: "Maria",
      name: null,
      phone_number: "+5531988887777",
      is_anonymized: false,
      tags: [],
      is_blocked: false,
      avatar_storage_path: null,
      force_human: false,
      created_by_user_id: CRIADOR,
    },
    ...overrides,
  };
}

function makeSupabase(rows: ReturnType<typeof conversationRow>[]) {
  const client = {
    from(table: string) {
      if (table !== "conversations") throw new Error(`fake_supabase: tabela inesperada '${table}'`);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        ilike: () => builder,
        contains: () => builder,
        not: () => builder,
        is: () => builder,
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

describe("listConversationsHandler — proteção do telefone embutido", () => {
  it("agent que não cadastrou o contato recebe telefone nulo na conversa", async () => {
    const supabase = makeSupabase([conversationRow()]);
    const result = await listConversationsHandler(
      supabase,
      ctxFor({ type: "user", id: OUTRO_USER, role: "agent" }),
      { limit: 20 },
    );
    const conv = result.conversations[0] as unknown as { contacts: { phone_number: string | null; contact_protected: boolean } };
    expect(conv.contacts.phone_number).toBeNull();
    expect(conv.contacts.contact_protected).toBe(true);
  });

  it("manager vê o telefone normalmente", async () => {
    const supabase = makeSupabase([conversationRow()]);
    const result = await listConversationsHandler(
      supabase,
      ctxFor({ type: "user", id: OUTRO_USER, role: "manager" }),
      { limit: 20 },
    );
    const conv = result.conversations[0] as unknown as { contacts: { phone_number: string | null } };
    expect(conv.contacts.phone_number).toBe("+5531988887777");
  });
});

describe("getConversationHandler — proteção do telefone embutido", () => {
  it("agent que cadastrou o próprio contato vê o telefone", async () => {
    const supabase = makeSupabase([conversationRow()]);
    const result = await getConversationHandler(
      supabase,
      ctxFor({ type: "user", id: CRIADOR, role: "agent" }),
      CONV_ID,
    );
    const conv = result as unknown as { contacts: { phone_number: string | null } };
    expect(conv.contacts.phone_number).toBe("+5531988887777");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/conversations-handler-protecao.test.ts`
Expected: FAIL — `contacts.created_by_user_id` not selected/masked yet.

- [ ] **Step 3: Implement**

In `app/api/v1/conversations/_handler.ts`, add the import:

```ts
import { protegerTelefoneDoContatoEmbutido } from "@/lib/contacts/visibility";
```

Change `SELECT_COLS`'s embedded contact list:

```ts
  contacts:contact_id (id, display_name, name, phone_number, is_anonymized, tags, is_blocked, avatar_storage_path, force_human)
```

to:

```ts
  contacts:contact_id (id, display_name, name, phone_number, is_anonymized, tags, is_blocked, avatar_storage_path, force_human, created_by_user_id)
```

Right after the `SELECT_COLS` constant, add the local type and helper:

```ts
type ConversationComContato = Conversation & {
  contacts?: {
    created_by_user_id: string | null;
    phone_number: string | null;
    [key: string]: unknown;
  } | null;
};

function protegerConversaComContato(
  conv: ConversationComContato,
  actor: Actor,
): ConversationComContato {
  if (!conv.contacts) return conv;
  return { ...conv, contacts: protegerTelefoneDoContatoEmbutido(conv.contacts, actor) };
}
```

In `listConversationsHandler`, change:

```ts
  const rows = (data ?? []) as unknown as Conversation[];
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
```

to:

```ts
  const rows = (data ?? []) as unknown as ConversationComContato[];
  const protegidas = rows.map((r) => protegerConversaComContato(r, ctx.actor));
  const hasMore = protegidas.length > q.limit;
  const page = hasMore ? protegidas.slice(0, q.limit) : protegidas;
```

In `getConversationHandler`, change:

```ts
  return data as unknown as Conversation;
}
```

to:

```ts
  return protegerConversaComContato(data as unknown as ConversationComContato, ctx.actor);
}
```

In `patchConversationHandler`, change:

```ts
  const conv = data as unknown as Conversation;
```

to:

```ts
  const conv = data as unknown as ConversationComContato;
```

and change the final return:

```ts
  return conv;
}
```

to:

```ts
  return protegerConversaComContato(conv, ctx.actor);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/conversations-handler-protecao.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/conversations/_handler.ts tests/unit/conversations-handler-protecao.test.ts
git commit -m "feat(conversas): protege telefone do contato embutido na conversa"
```

---

### Task 7: Popular `actor.role` nas rotas REST de conversas

**Files:**
- Modify: `app/api/v1/conversations/route.ts:30-63` (GET)
- Modify: `app/api/v1/conversations/[id]/route.ts:37-47` (GET), `:89-90` (PATCH)

Mesmo motivo do Task 5, agora para conversas.

- [ ] **Step 1: `app/api/v1/conversations/route.ts` — GET**

Find the block ending in `actor: { type: "user", id: user.id },` (right after `activeOrg = await resolveActiveOrg(authUser) : null;`) and change it to:

```ts
        actor: { type: "user", id: user.id, role: activeOrg?.role },
```

- [ ] **Step 2: `app/api/v1/conversations/[id]/route.ts` — GET (line ~47)**

Change:

```ts
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
```

(first occurrence, inside the GET handler) to:

```ts
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id, role: activeOrg.role },
        requestId,
      },
```

- [ ] **Step 3: `app/api/v1/conversations/[id]/route.ts` — PATCH (line ~90)**

Change the second occurrence of the same pattern (inside the PATCH handler) identically:

```ts
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id, role: activeOrg.role },
        requestId,
      },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/conversations/route.ts "app/api/v1/conversations/[id]/route.ts"
git commit -m "fix(conversas): repassa o role do ator pro handler (necessário pra proteção de telefone)"
```

---

### Task 8: Tipo `ContactSummary` no client (conversas)

**Files:**
- Modify: `hooks/inbox/useConversationsRealtime.ts:9-28`

**Interfaces:**
- Produces: `ContactSummary.contact_protected?: boolean`, consumed by Task 12.

- [ ] **Step 1: Edit the type**

Change:

```ts
export interface ContactSummary {
  id: string;
  display_name: string | null;
  name: string | null;
  phone_number: string | null;
  tags: string[];
  is_blocked: boolean;
  is_anonymized: boolean;
```

to:

```ts
export interface ContactSummary {
  id: string;
  display_name: string | null;
  name: string | null;
  phone_number: string | null;
  tags: string[];
  is_blocked: boolean;
  is_anonymized: boolean;
  /** true quando phone_number veio nulo por proteção (não cadastrado por você). */
  contact_protected?: boolean;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors (optional field, purely additive).

- [ ] **Step 3: Commit**

```bash
git add hooks/inbox/useConversationsRealtime.ts
git commit -m "feat(inbox): tipo do contato embutido reconhece contact_protected"
```

---

### Task 9: Componente compartilhado `ContatoProtegido`

**Files:**
- Create: `components/contacts/ContatoProtegido.tsx`

**Interfaces:**
- Produces: `<ContatoProtegido valor={string | null} protegido={boolean} />`, consumed by Tasks 10–12.

- [ ] **Step 1: Create the component**

```tsx
import { Lock } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";

interface Props {
  valor: string | null;
  protegido: boolean;
}

/**
 * Telefone/e-mail de um lead que o corretor não cadastrou — protegido pela
 * regra em lib/contacts/visibility.ts. Nunca mostra nenhum dígito: o corretor
 * atende pelo chat do CRM, não pelo número.
 */
export function ContatoProtegido({ valor, protegido }: Props) {
  if (!protegido) return <>{valor ?? "—"}</>;
  return (
    <Badge variant="neutral" className="gap-1" title="Você não cadastrou este contato — atenda pelo chat do CRM.">
      <Lock size={10} weight="bold" aria-hidden />
      Protegido
    </Badge>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/contacts/ContatoProtegido.tsx
git commit -m "feat(contatos): componente ContatoProtegido (badge de telefone/email ocultos)"
```

---

### Task 10: Ligar em `ContactsTable`

**Files:**
- Modify: `components/contacts/ContactsTable.tsx:14`, `:47-53`

- [ ] **Step 1: Add the import**

Change:

```ts
import type { Contact } from "@/lib/types/contacts";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
```

to:

```ts
import type { Contact } from "@/lib/types/contacts";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { ContatoProtegido } from "@/components/contacts/ContatoProtegido";
```

- [ ] **Step 2: Replace the two cells**

Change:

```tsx
            <TableCell className="text-muted-foreground">
              {c.email ?? "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {c.phone_number ?? "—"}
            </TableCell>
```

to:

```tsx
            <TableCell className="text-muted-foreground">
              <ContatoProtegido valor={c.email} protegido={c.contact_protected} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              <ContatoProtegido valor={c.phone_number} protegido={c.contact_protected} />
            </TableCell>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/contacts/ContactsTable.tsx
git commit -m "feat(contatos): tabela de contatos mostra badge Protegido"
```

---

### Task 11: Ligar na página de detalhe do contato

**Files:**
- Modify: `app/app/contacts/[id]/_client.tsx:17`, `:80-82`, `:132`, `:136`

- [ ] **Step 1: Add the import**

Add near the other component imports:

```ts
import { ContatoProtegido } from "@/components/contacts/ContatoProtegido";
```

- [ ] **Step 2: Replace the header line**

Change:

```tsx
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {contact.email && <span>{contact.email}</span>}
            {contact.email && contact.phone_number && <span>•</span>}
            {contact.phone_number && <span>{contact.phone_number}</span>}
          </div>
```

to:

```tsx
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {contact.contact_protected ? (
              <ContatoProtegido valor={null} protegido />
            ) : (
              <>
                {contact.email && <span>{contact.email}</span>}
                {contact.email && contact.phone_number && <span>•</span>}
                {contact.phone_number && <span>{contact.phone_number}</span>}
              </>
            )}
          </div>
```

- [ ] **Step 3: Replace the two `dl` rows**

Change:

```tsx
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Email</dt>
                <dd className="mt-1">{contact.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Telefone</dt>
                <dd className="mt-1">{contact.phone_number ?? "—"}</dd>
              </div>
```

to:

```tsx
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Email</dt>
                <dd className="mt-1">
                  <ContatoProtegido valor={contact.email} protegido={contact.contact_protected} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Telefone</dt>
                <dd className="mt-1">
                  <ContatoProtegido valor={contact.phone_number} protegido={contact.contact_protected} />
                </dd>
              </div>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/app/contacts/[id]/_client.tsx"
git commit -m "feat(contatos): página de detalhe mostra badge Protegido"
```

---

### Task 12: Ligar no inbox (cabeçalho da conversa e painel lateral)

**Files:**
- Modify: `components/inbox/ConversationHeader.tsx:1-15`, `:45`, `:89-94`
- Modify: `components/inbox/CRMSidePanel.tsx:14`, `:343-345`

- [ ] **Step 1: `ConversationHeader.tsx` — import**

Add:

```ts
import { ContatoProtegido } from "@/components/contacts/ContatoProtegido";
```

- [ ] **Step 2: `ConversationHeader.tsx` — render**

Change:

```tsx
        {phone && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Phone size={11} weight="regular" aria-hidden /> {phone}
          </p>
        )}
```

to:

```tsx
        {(phone || c?.contact_protected) && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Phone size={11} weight="regular" aria-hidden />
            <ContatoProtegido valor={phone} protegido={Boolean(c?.contact_protected)} />
          </p>
        )}
```

- [ ] **Step 3: `CRMSidePanel.tsx` — import**

Add:

```ts
import { ContatoProtegido } from "@/components/contacts/ContatoProtegido";
```

- [ ] **Step 4: `CRMSidePanel.tsx` — render**

Change:

```tsx
          {contact?.phone_number && (
            <div className="text-xs text-muted-foreground">{contact.phone_number}</div>
          )}
```

to:

```tsx
          {(contact?.phone_number || contact?.contact_protected) && (
            <div className="text-xs text-muted-foreground">
              <ContatoProtegido
                valor={contact?.phone_number ?? null}
                protegido={Boolean(contact?.contact_protected)}
              />
            </div>
          )}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/inbox/ConversationHeader.tsx components/inbox/CRMSidePanel.tsx
git commit -m "feat(inbox): cabeçalho e painel lateral mostram badge Protegido"
```

---

### Task 13: Desabilitar edição de telefone/email protegidos no diálogo

**Files:**
- Modify: `components/contacts/EditContactDialog.tsx:96-103`

Fecha o último ponto de UI: sem isto, o corretor vê os campos em branco (porque
vieram `null`) e pode digitar um número novo, achando que está preenchendo um
campo vazio — quando na verdade sobrescreveria (a API já bloqueia isso desde o
Task 4, mas a tela deve deixar claro ANTES de tentar, não só devolver erro).

- [ ] **Step 1: Edit the two inputs**

Change:

```tsx
          <div className="space-y-2">
            <Label htmlFor="ec-email">Email</Label>
            <Input id="ec-email" type="email" {...form.register("email")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-phone">Telefone (E.164)</Label>
            <Input id="ec-phone" {...form.register("phone_number")} />
          </div>
```

to:

```tsx
          <div className="space-y-2">
            <Label htmlFor="ec-email">Email</Label>
            <Input id="ec-email" type="email" disabled={contact.contact_protected} {...form.register("email")} />
            {contact.contact_protected && (
              <p className="text-xs text-muted-foreground">Protegido — você não cadastrou este contato.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec-phone">Telefone (E.164)</Label>
            <Input id="ec-phone" disabled={contact.contact_protected} {...form.register("phone_number")} />
            {contact.contact_protected && (
              <p className="text-xs text-muted-foreground">Protegido — você não cadastrou este contato.</p>
            )}
          </div>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/contacts/EditContactDialog.tsx
git commit -m "feat(contatos): diálogo de edição desabilita telefone/email protegidos"
```

---

### Task 14: Verificação completa e prova visual

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `pnpm test:unit`
Expected: all files pass, including the 3 new test files from Tasks 1/3/4/6.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Prova visual manual**

Start the dev server (`npm run dev`), log in as an `agent`-role test user in an
org with at least one contact NOT created by that user (e.g. a WhatsApp-inbound
lead) and one contact the same user creates on the spot via "Add contact":

1. Open `/app/contacts` — confirm the inbound lead shows the "Protegido" badge
   in both Email and Telefone columns, and the self-created contact shows the
   real values.
2. Open the inbound lead's detail page (`/app/contacts/[id]`) — confirm the
   header and the Email/Telefone `dl` rows show "Protegido"; click "Editar" and
   confirm both fields are disabled with the "Protegido — você não cadastrou
   este contato." caption.
3. Open the inbox (`/app/inbox`), select the conversation with that same
   inbound lead — confirm the conversation header and the CRM side panel show
   "Protegido" instead of the phone number, and that sending a message from
   the chat box still works normally (proves the chat path never needed the
   raw number).
4. Log in as a `manager`-role user in the same org — confirm both contacts show
   full phone/email everywhere from step 1–3.

Record the outcome (pass/fail per point) — this is the Definition-of-Done
evidence required by the "QA Visual com Recursos Reais" doctrine in
`CLAUDE.md` for any change touching a user-facing flow.

- [ ] **Step 4: Final commit (if step 3 required any fixups)**

```bash
git add -A
git commit -m "fix: ajustes da prova visual da proteção de telefone/email"
```

(Skip this step if step 3 required no code changes.)

---

### Task 15: Fechar o vazamento pelas propostas de dado da IA

**Files:**
- Modify: `app/api/v1/contacts/[id]/proposals/route.ts` (GET — filtra propostas sensíveis)
- Modify: `app/api/v1/contacts/[id]/proposals/[proposal_id]/route.ts:137-140` (passa `role` no actor)
- Test: `tests/unit/propostas-dado-protecao.test.ts`

**Dispatch order note:** execute this task BEFORE Task 14 (Task 14 is the final
verification of the whole feature and must run last).

**Interfaces:**
- Consumes: `podeVerContatoSensivel` from Task 1 (`@/lib/contacts/visibility`).

**Por que este task existe.** A IA escuta a conversa, extrai o telefone/e-mail
que o cliente falou, e grava uma linha `pending` em `contact_field_proposals`
para um humano confirmar. A rota GET devolve `valor_proposto`, `valor_anterior`
E `trecho` (o pedaço literal do que o cliente escreveu). Para um corretor que
NÃO cadastrou aquele contato, isso entrega exatamente o dado que as Tasks 3/6
esconderam — a proteção do resto da feature seria contornável por esta tela.
A rota de decisão (`accept`) chama `patchContactHandler`, que desde a Task 4
recusa com 403 `contact_protected` — mas hoje ela passa um actor SEM `role`,
o que faria a guarda recusar até para gerente/admin.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/propostas-dado-protecao.test.ts`:

```ts
/**
 * A proteção de telefone/e-mail não pode ser contornada pela fila de propostas
 * da IA — ver docs/superpowers/specs/2026-08-09-protecao-contato-corretor-design.md.
 */
import { describe, expect, it } from "vitest";

import { podeVerContatoSensivel } from "@/lib/contacts/visibility";
import { CAMPOS_SENSIVEIS_DA_PROPOSTA, filtrarPropostasVisiveis } from "@/lib/contacts/visibility";
import type { Actor } from "@/lib/api/handlers/types";

const CRIADOR = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

const propostas = [
  { id: "p1", campo: "phone_number", valor_proposto: "+5531988887777" },
  { id: "p2", campo: "email", valor_proposto: "a@b.com" },
  { id: "p3", campo: "name", valor_proposto: "Maria Silva" },
];

describe("filtrarPropostasVisiveis", () => {
  it("corretor que não cadastrou não recebe proposta de telefone nem de e-mail", () => {
    const actor: Actor = { type: "user", id: OUTRO, role: "agent" };
    const visiveis = filtrarPropostasVisiveis(propostas, actor, CRIADOR);
    expect(visiveis.map((p) => p.id)).toEqual(["p3"]);
  });

  it("corretor que cadastrou o contato recebe todas", () => {
    const actor: Actor = { type: "user", id: CRIADOR, role: "agent" };
    const visiveis = filtrarPropostasVisiveis(propostas, actor, CRIADOR);
    expect(visiveis.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("gerente recebe todas mesmo sem ter cadastrado", () => {
    const actor: Actor = { type: "user", id: OUTRO, role: "manager" };
    const visiveis = filtrarPropostasVisiveis(propostas, actor, CRIADOR);
    expect(visiveis.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("proposta de nome nunca é filtrada, nem em contato sem criador", () => {
    const actor: Actor = { type: "user", id: OUTRO, role: "agent" };
    const visiveis = filtrarPropostasVisiveis(propostas, actor, null);
    expect(visiveis.map((p) => p.id)).toEqual(["p3"]);
  });

  it("os campos sensíveis são exatamente telefone e e-mail", () => {
    expect([...CAMPOS_SENSIVEIS_DA_PROPOSTA].sort()).toEqual(["email", "phone_number"]);
    // `name` é proponível (CAMPOS_PROPONIVEIS) e deliberadamente NÃO é sensível:
    // esconder o nome tiraria a utilidade da fila sem proteger contato nenhum.
    expect(podeVerContatoSensivel({ type: "user", id: OUTRO, role: "agent" }, CRIADOR)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/propostas-dado-protecao.test.ts`
Expected: FAIL — `filtrarPropostasVisiveis`/`CAMPOS_SENSIVEIS_DA_PROPOSTA` not exported.

- [ ] **Step 3: Add the helper to `lib/contacts/visibility.ts`**

Append to `lib/contacts/visibility.ts`:

```ts
/**
 * Campos de `contact_field_proposals` que carregam contato direto. `name` fica
 * de fora de propósito: esconder o nome tiraria a utilidade da fila sem
 * proteger ninguém.
 */
export const CAMPOS_SENSIVEIS_DA_PROPOSTA = ["email", "phone_number"] as const;

/**
 * Some com as propostas de telefone/e-mail para quem não pode ver o dado bruto
 * daquele contato — senão a fila da IA entrega o que o resto da feature
 * esconde. Quem pode ver continua vendo tudo.
 */
export function filtrarPropostasVisiveis<T extends { campo: string }>(
  propostas: T[],
  actor: Actor,
  contactCreatedByUserId: string | null,
): T[] {
  if (podeVerContatoSensivel(actor, contactCreatedByUserId)) return propostas;
  return propostas.filter(
    (p) => !(CAMPOS_SENSIVEIS_DA_PROPOSTA as readonly string[]).includes(p.campo),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/propostas-dado-protecao.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire the GET route**

In `app/api/v1/contacts/[id]/proposals/route.ts`, add the import:

```ts
import { filtrarPropostasVisiveis } from "@/lib/contacts/visibility";
```

Replace the final `return ok(...)` block. Change:

```ts
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok({ items: (data ?? []) as PropostaViva[] }, { requestId });
```

to:

```ts
  if (error) return fail("internal_error", error.message, 500, { requestId });

  // Quem cadastrou o contato decide se as propostas de telefone/e-mail podem
  // ser vistas — a fila da IA não pode ser a porta dos fundos da proteção.
  const { data: dono } = await supabase
    .from("contacts")
    .select("created_by_user_id")
    .eq("id", contactId)
    .eq("organization_id", guard.org.orgId)
    .maybeSingle();

  const items = filtrarPropostasVisiveis(
    (data ?? []) as PropostaViva[],
    { type: "user", id: guard.user.id, role: guard.org.role },
    (dono as { created_by_user_id: string | null } | null)?.created_by_user_id ?? null,
  );

  return ok({ items }, { requestId });
```

- [ ] **Step 6: Wire the decision route**

In `app/api/v1/contacts/[id]/proposals/[proposal_id]/route.ts`, find the
`patchContactHandler` call (~line 137) and change:

```ts
      { organization_id: orgId, actor: { type: "user", id: userId }, requestId },
```

to:

```ts
      // `role` é obrigatório aqui: sem ele a guarda de contato protegido
      // (patchContactHandler) avalia rank 0 e recusaria até para admin.
      { organization_id: orgId, actor: { type: "user", id: userId, role: guard.org.role }, requestId },
```

If the local variable holding the `requireRole` result is not named `guard` in
that file, use whatever name it has (it is assigned at line ~60).

- [ ] **Step 7: Typecheck + full affected tests**

Run: `npx tsc --noEmit -p . && npx vitest run tests/unit/propostas-dado-protecao.test.ts tests/unit/contacts-handler-protecao.test.ts`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/contacts/visibility.ts "app/api/v1/contacts/[id]/proposals/route.ts" "app/api/v1/contacts/[id]/proposals/[proposal_id]/route.ts" tests/unit/propostas-dado-protecao.test.ts
git commit -m "feat(contatos): fila de propostas da IA respeita a proteção de telefone/email"
```
