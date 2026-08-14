import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * AS DUAS LISTAS DE AÇÃO DE AUDITORIA PARAM DE DIVERGIR MAIS.
 *
 * ─── O defeito, medido ──────────────────────────────────────────────────────
 *
 * `lib/audit/actions.ts` declara o union `AuditAction` — o vocabulário do que o
 * produto grava em `api_audit_log.action`. `components/admin/audit/action-codes.ts`
 * declara `ACTION_CODES`, a lista plana que vira o multi-select do painel de
 * auditoria. O comentário do topo do segundo diz *"Keep in sync manually"*, e
 * **não havia gate nenhum cobrando isso**.
 *
 * Medido em 2026-08-14, no SHA 741c4ec8: **209 códigos no union, 89 no painel,
 * 120 que existem, são emitidos e NÃO são filtráveis na tela.** O inverso é 0.
 *
 * O modo de falha é silencioso dos dois lados: quem emite não percebe (o código
 * novo passa no typecheck, a linha entra no banco), e quem investiga também não
 * (o filtro simplesmente não oferece a opção, e a ausência de uma opção num
 * `<select>` não parece defeito — parece que aquilo não existe). É a auditoria
 * ficando cega exatamente sobre o que foi acrescentado depois.
 *
 * ─── Por que este gate NASCE VERDE, e não conserta as 120 ───────────────────
 *
 * Curar 120 entradas alheias é item próprio: metade delas quer sub-rótulo na UI,
 * e o conserto certo é DERIVAR a lista do union em vez de copiá-la melhor. Um
 * gate que nascesse vermelho com 120 dívidas alheias seria desligado no primeiro
 * PR que esbarrasse nele — a lição de `feedback_gate_que_nasce_vermelho`.
 *
 * Então ele congela o conjunto ATUAL e reprova **acréscimo**: código novo no
 * union sem entrada no painel fica vermelho no `verify`, no PR de quem o
 * acrescentou, que é quem sabe qual é o rótulo certo. A dívida para de crescer
 * hoje; encolher é um item, não uma promessa.
 *
 * ─── Por que a lista congelada também não pode INCHAR nem ficar velha ───────
 *
 * O caso "a lista congelada não guarda código já curado" existe porque, sem ele,
 * curar `ai.router_created` (pondo-o no painel) deixaria uma linha morta aqui — e
 * essa linha morta seria uma autorização permanente para alguém removê-lo do
 * painel de novo, sem nada reprovar. Mesmo desenho da guarda de marca
 * (`tests/unit/branding.test.ts`), que reprova até a linha ser apagada: catraca
 * que só aperta.
 */

const RAIZ = process.cwd();

/**
 * Comentário sai ANTES do recorte. Não é zelo: a primeira versão desta varredura
 * recortava o union primeiro (`=([\s\S]*?);`) e um `;` dentro de um comentário do
 * corpo truncava o match — dava 204 códigos em vez de 209, e a diferença
 * apareceu como "5 códigos que estão no painel e não no union", que é falso.
 * Instrumento quebrado devolve número plausível.
 */
function semComentario(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}

function leia(relativo: string): string {
  return semComentario(fs.readFileSync(path.join(RAIZ, relativo), "utf8"));
}

function recorte(fonte: string, ancora: RegExp, oQue: string): string {
  const m = ancora.exec(fonte);
  // LANÇA, não devolve vazio. Renomear ou mover a declaração faria a varredura
  // comparar conjuntos vazios, e conjunto vazio passa em toda asserção de
  // `toEqual([])` — o gate ficaria verde sobre nada e ninguém saberia. Erro de
  // coleta é barulhento; zero silencioso não é.
  if (m === null) {
    throw new Error(`não achei ${oQue} — ENSINE ESTE TESTE em vez de deixá-lo verde`);
  }
  return m[1] ?? "";
}

function codigos(corpo: string): string[] {
  return [...corpo.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

const UNION = codigos(
  recorte(
    leia("lib/audit/actions.ts"),
    /export type AuditAction\s*=([\s\S]*?);/,
    "o union AuditAction em lib/audit/actions.ts",
  ),
);

const PAINEL = codigos(
  recorte(
    leia("components/admin/audit/action-codes.ts"),
    /export const ACTION_CODES:\s*string\[\]\s*=\s*\[([\s\S]*?)\];/,
    "o array ACTION_CODES em components/admin/audit/action-codes.ts",
  ),
);

/**
 * A DÍVIDA CONGELADA — 120 códigos emitidos que o painel não oferece como filtro.
 * Medido em 2026-08-14 no SHA 741c4ec8, gerado por varredura, não à mão.
 *
 * Esta lista só ENCOLHE. Quem curar um código apaga a linha dele no mesmo commit
 * (o caso "a lista congelada não guarda código já curado" cobra isso).
 */
const DIVERGENCIA_CONGELADA: ReadonlySet<string> = new Set([
  "ai.case_replied",
  "ai.credential_created",
  "ai.credential_deleted",
  "ai.credential_revalidated",
  "ai.dispatcher_run",
  "ai.flywheel_proposal_applied",
  "ai.guardrail_layer_changed",
  "ai.inbox_item_status_changed",
  "ai.org_memory_entry_created",
  "ai.org_memory_entry_updated",
  "ai.org_memory_published",
  "ai.pacing_knobs_updated",
  "ai.purpose_binding_updated",
  "ai.router_created",
  "ai.router_deleted",
  "ai.router_members_updated",
  "ai.router_updated",
  "ai.skill_imported",
  "ai.skill_installed",
  "ai.skill_uninstalled",
  "ai_agent.archived",
  "ai_agent.created",
  "ai_agent.duplicated",
  "ai_agent.paused",
  "ai_agent.published",
  "ai_agent.reverted",
  "ai_agent.run_completed",
  "ai_agent.run_failed",
  "ai_agent.run_started",
  "ai_agent.tested",
  "ai_agent.updated",
  "ai_agent.version_created",
  "ai_agent.version_updated",
  "attendant.availability_changed",
  "attendant.heartbeat_swept",
  "auth.email_link_rejected",
  "auth.login_rate_limited",
  "auth.password_reset_completed",
  "auth.password_reset_failed",
  "auth.password_reset_request_failed",
  "auth.password_reset_requested",
  "auth.signup_confirmed",
  "auth.signup_failed",
  "auth.signup_provision_failed",
  "auth.signup_requested",
  "authz.denied",
  "automation.rule_created",
  "automation.rule_deleted",
  "automation.rule_executed",
  "automation.rule_updated",
  "automation.run_resent",
  "channel.archived",
  "channel.connected",
  "channel.deleted",
  "channel.reactivated",
  "channel.reconnected",
  "contact.field_confirmed",
  "contact.field_proposed",
  "contact.field_rejected",
  "contact.tags_changed",
  "conversation.note_added",
  "conversation.note_deleted",
  "conversation.snooze_cancelled",
  "conversation.snooze_watcher_run",
  "conversation.snoozed",
  "conversation.tags_changed",
  "conversation.transferred",
  "demanda.proximo_passo_definido",
  "followup.cancelled",
  "followup.scheduled",
  "followup.silence_sweep_run",
  "followup.worker_run",
  "followup_enrollment.cancelled",
  "followup_enrollment.created",
  "followup_enrollment.paused",
  "followup_enrollment.resumed",
  "followup_enrollment.snoozed",
  "followup_enrollment.step_skipped",
  "followup_flow.created",
  "followup_flow.disabled",
  "followup_flow.published",
  "followup_flow.rolled_back",
  "followup_flow.updated",
  "incident.resolved",
  "lead.reactivation_proposed",
  "lead.tags_changed",
  "leads.bulk_assigned",
  "mcp.tool_called",
  "message.recover_stuck_run",
  "metrics.atrito_regua_changed",
  "pipeline.agent_mapping_updated",
  "pipeline.archived",
  "pipeline.created",
  "pipeline.deleted",
  "pipeline.stage_archived",
  "pipeline.stage_created",
  "pipeline.stage_updated",
  "pipeline.updated",
  "platform_admin.incident_viewed",
  "platform_admin.incidents_listed",
  "platform_admin.lgpd_listed",
  "platform_admin.lgpd_request_viewed",
  "platform_admin.platform_admins_listed",
  "platform_admin.usage_viewed",
  "platform_admin.user_viewed",
  "platform_admin.users_listed",
  "routing.config_changed",
  "routing.worker_run",
  "system.update_finished",
  "system.update_requested",
  "team.role_changed",
  "template.created",
  "template.deleted",
  "template.updated",
  "tenant.created_by_signup",
  "webhook.inbound_invalid_signature",
  "webhook.lead_received",
  "webhook.source_created",
  "webhook.source_deleted",
  "webhook.source_updated",
]);

const noPainel = new Set(PAINEL);
const divergentes = UNION.filter((c) => !noPainel.has(c));

describe("audit: o union e o filtro do painel param de divergir mais", () => {
  it("as duas listas foram REALMENTE lidas (guarda de vacuidade)", () => {
    // Sem isto, qualquer falha de parse produziria conjuntos vazios e TODOS os
    // casos abaixo passariam — o instrumento quebrado devolvendo zero.
    expect(UNION.length, "union de AuditAction implausivelmente curto").toBeGreaterThan(150);
    expect(PAINEL.length, "ACTION_CODES implausivelmente curto").toBeGreaterThan(50);
    expect(new Set(UNION).size, "código repetido no union").toBe(UNION.length);
    expect(new Set(PAINEL).size, "código repetido em ACTION_CODES").toBe(PAINEL.length);
    // Âncora de conteúdo: um código que existe nas duas listas desde a Fase 3
    // deste épico. Se o recorte pegasse o bloco errado, isto cai.
    expect(UNION).toContain("org.branding_updated");
    expect(PAINEL).toContain("org.branding_updated");
  });

  it("código novo no union entra no painel — a dívida não cresce", () => {
    const acrescimos = divergentes.filter((c) => !DIVERGENCIA_CONGELADA.has(c));
    expect(
      acrescimos,
      "Você acrescentou código de auditoria em lib/audit/actions.ts sem acrescentá-lo em " +
        "components/admin/audit/action-codes.ts. A linha vai para api_audit_log e o filtro " +
        "do painel não a oferece: a trilha existe e ninguém a encontra. Acrescente o código " +
        "nas DUAS listas — e não o ponha na DIVERGENCIA_CONGELADA, que só encolhe.\n",
    ).toEqual([]);
  });

  it("a lista congelada não guarda código que já foi curado", () => {
    const naDivergencia = new Set(divergentes);
    const mortos = [...DIVERGENCIA_CONGELADA].filter((c) => !naDivergencia.has(c));
    expect(
      mortos,
      "Estes códigos saíram da divergência (ou do union) e continuam congelados aqui. " +
        "Linha morta na lista é autorização permanente para removê-los do painel de novo " +
        "sem nada reprovar. Apague-as no mesmo commit que curou.\n",
    ).toEqual([]);
  });

  it("nenhuma opção do painel é filtro morto", () => {
    const noUnion = new Set(UNION);
    const fantasmas = PAINEL.filter((c) => !noUnion.has(c));
    expect(
      fantasmas,
      "ACTION_CODES oferece filtro para código que o union não declara: nenhuma linha de " +
        "api_audit_log pode ter esse valor, então o filtro devolve vazio para sempre e lê-se " +
        "como 'não aconteceu' em vez de 'não existe'.\n",
    ).toEqual([]);
  });
});
