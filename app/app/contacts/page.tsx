import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { ContactsListClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * A tela de contatos.
 *
 * ⚠️ DIVERGÊNCIA DESTE FORK: o botão "Duplicados" é manager+.
 *
 * `GET /api/v1/contacts/duplicates` aqui cobra `manager` (no upstream é aberta a
 * `viewer`) porque a resposta dela agrupa POR TELEFONE/E-MAIL — a chave do grupo
 * É o dado — e a proteção de contato deste fork esconde esses dois campos do
 * corretor que não cadastrou o lead. O motivo inteiro está no cabeçalho da rota.
 *
 * O papel é resolvido AQUI, no servidor, pelo mesmo critério da rota (o papel na
 * organização ativa, sem atalho de platform admin). Mostrar um botão que o
 * servidor recusaria seria prometer o que não se cumpre — e o diálogo abriria
 * vazio, com um 403 que a pessoa leria como defeito. Mesmo padrão de
 * `app/app/kanban/page.tsx`.
 */
export default async function ContactsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeJuntarDuplicados = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  return <ContactsListClient podeJuntarDuplicados={podeJuntarDuplicados} />;
}
