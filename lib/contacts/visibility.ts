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
  // Opcional: `email_normalized` (coluna gerada `lower(trim(email))`) só existe
  // em quem seleciona SELECT_COLS. Opcional aqui para não obrigar chamador que
  // nem pede a coluna (e testes com objeto reduzido) a fingir que ela existe.
  email_normalized?: string | null;
}

/** Contato completo (API /contacts, MCP) — protege telefone E e-mail. */
export function protegerContato<T extends ContatoComTelefoneEEmail>(
  contact: T,
  actor: Actor,
): T & { contact_protected: boolean } {
  if (podeVerContatoSensivel(actor, contact.created_by_user_id)) {
    return { ...contact, contact_protected: false };
  }
  return {
    ...contact,
    phone_number: null,
    email: null,
    // `email_normalized` é `lower(trim(email))` — o MESMO e-mail em outra
    // coluna. Nular só `email` e deixar esta ficaria a mesma porta dos fundos:
    // o JSON de resposta ainda carregaria o e-mail bruto (só em minúsculas).
    // Só entra quando a coluna foi de fato selecionada (chave presente no
    // objeto de origem), pra não introduzir a chave em chamador que não a pede.
    ...(contact.email_normalized !== undefined ? { email_normalized: null } : {}),
    contact_protected: true,
  };
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
