/**
 * Os chamados humanos — leitura compartilhada entre a tela e o agente.
 *
 * As duas consultas viviam dentro de `app/api/v1/ai/cases/route.ts` e
 * `.../[id]/route.ts`, servindo só à tela. O agente abria o chamado e não
 * conseguia mais olhar para ele: não sabia listar, não sabia se foi respondido,
 * não lia o que a pessoa decidiu. Extraído (Decisão 4 do briefing IA 360) para
 * que a pessoa e o agente vejam o MESMO chamado, pela mesma consulta.
 *
 * Só leitura aqui. A máquina de estados do chamado é
 * `lib/agent-engine/agent/human-cases.ts` (transições sobre `pg`, atômicas) —
 * duplicá-la em PostgREST daria dois donos para a mesma regra.
 *
 * PROTEÇÃO DE CONTATO (C2 da revisão final): estas duas consultas rodam com o
 * client SERVICE-ROLE (RLS bypassada) e o gate de rota é só `agent`, então sem
 * aplicar `podeVerContatoSensivel` aqui QUALQUER agente enxergaria o telefone
 * de um lead que não cadastrou — a mesma porta que o resto da feature fecha em
 * /api/v1/contacts. O ator entra por parâmetro (o CHAMADOR resolve o role via
 * `requireRole`, esta função não sabe nada de HTTP).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { podeVerContatoSensivel } from "@/lib/contacts/visibility";

export const ESTADOS_ABERTOS = ["awaiting_human", "awaiting_lead"] as const;
export const ESTADOS_FECHADOS = ["resolved", "escalated", "cancelled"] as const;

export interface ChamadoDaLista {
  id: string;
  title: string;
  summary: string;
  blocker: string;
  status: string;
  opened_at: string;
  conversation_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  /** `true` quando `contact_phone` veio nulado por proteção de contato. */
  contact_protected: boolean;
}

export interface EventoDoChamado {
  id: string;
  kind: string;
  actor_kind: string;
  actor_user_id: string | null;
  human_action: string | null;
  body: string | null;
  created_at: string;
}

export interface ChamadoDetalhado extends ChamadoDaLista {
  source: string;
  closed_at: string | null;
  events: EventoDoChamado[];
}

const COLUNAS_LISTA =
  "id, title, summary, blocker, status, opened_at, conversation_id, " +
  "conversations:conversation_id(contacts:contact_id(name, phone_number, created_by_user_id))";

const COLUNAS_DETALHE =
  "id, title, summary, blocker, status, source, opened_at, closed_at, conversation_id, " +
  "conversations:conversation_id(contacts:contact_id(name, phone_number, created_by_user_id))";

interface LinhaComContato {
  id: string;
  title: string;
  summary: string;
  blocker: string;
  status: string;
  opened_at: string;
  conversation_id: string;
  source?: string;
  closed_at?: string | null;
  conversations: {
    contacts: { name: string | null; phone_number: string | null; created_by_user_id: string | null } | null;
  } | null;
}

function achatarContato(r: LinhaComContato, actor: Actor): ChamadoDaLista {
  const contato = r.conversations?.contacts ?? null;
  const podeVer = podeVerContatoSensivel(actor, contato?.created_by_user_id ?? null);
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    blocker: r.blocker,
    status: r.status,
    opened_at: r.opened_at,
    conversation_id: r.conversation_id,
    contact_name: contato?.name ?? null,
    contact_phone: podeVer ? (contato?.phone_number ?? null) : null,
    contact_protected: !podeVer,
  };
}

export interface ResultadoDaLista {
  chamados: ChamadoDaLista[];
  /** Quantos continuam abertos — independe do filtro pedido. */
  abertos: number;
}

export async function listarChamados(
  supabase: SupabaseClient,
  organizationId: string,
  opts: { estado: "abertos" | "fechados"; limite?: number },
  actor: Actor,
): Promise<ResultadoDaLista> {
  const estados = opts.estado === "abertos" ? ESTADOS_ABERTOS : ESTADOS_FECHADOS;

  const base = supabase
    .from("agent_cases")
    .select(COLUNAS_LISTA)
    .eq("organization_id", organizationId)
    .in("status", estados as unknown as string[])
    .order("opened_at", { ascending: false });

  const { data, error } = await (opts.limite === undefined ? base : base.limit(opts.limite));
  if (error) throw new Error(error.message);

  const { count } = await supabase
    .from("agent_cases")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ESTADOS_ABERTOS as unknown as string[]);

  return {
    chamados: ((data ?? []) as unknown as LinhaComContato[]).map((r) => achatarContato(r, actor)),
    abertos: count ?? 0,
  };
}

/** null = não existe OU é de outra organização — 404 honesto, sem vazar existência. */
export async function lerChamado(
  supabase: SupabaseClient,
  organizationId: string,
  caseId: string,
  actor: Actor,
): Promise<ChamadoDetalhado | null> {
  const { data: caseRow, error: caseErr } = await supabase
    .from("agent_cases")
    .select(COLUNAS_DETALHE)
    .eq("id", caseId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (caseErr) throw new Error(caseErr.message);
  if (!caseRow) return null;

  const { data: events, error: eventsErr } = await supabase
    .from("agent_case_events")
    .select("id, kind, actor_kind, actor_user_id, human_action, body, created_at")
    .eq("organization_id", organizationId)
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (eventsErr) throw new Error(eventsErr.message);

  const linha = caseRow as unknown as LinhaComContato;
  return {
    ...achatarContato(linha, actor),
    source: linha.source ?? "agent",
    closed_at: linha.closed_at ?? null,
    events: (events ?? []) as EventoDoChamado[],
  };
}
