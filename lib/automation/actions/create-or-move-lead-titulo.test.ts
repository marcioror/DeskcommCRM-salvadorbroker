/**
 * ⚠️ ARQUIVO SEPARADO DE PROPÓSITO — ele nasceu como `create-or-move-lead.test.ts`
 * e colidiu (add/add) na fusão de 2026-09-07: o upstream criou um arquivo com o
 * MESMO caminho, medindo outra coisa (classificação inicial não bloqueia
 * encaminhamento). Nenhum dos dois é descartável, e um nome próprio é o que
 * impede a colisão de voltar em toda sincronização.
 *
 * A montagem também difere e não daria para fundir num arquivo só: o do
 * upstream usa o dublê `tests/helpers/stages-db-double` e exercita a ação
 * contra um banco simulado; este aqui mocka `@/app/api/v1/leads/_handler` para
 * inspecionar o `title` EXATO que chega ao criador do lead.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Achado I2 da revisão final (2ª rodada) — `title: contact.name ??
 * contact.display_name ?? contact.phone_number ?? "Lead da automação"` caía
 * no telefone quando o contato não tem nome usável. `title` é coluna de
 * texto plano que `app/api/v1/leads/route.ts` devolve a QUALQUER viewer, e a
 * proteção per-viewer de contato não alcança essa cópia — uma vez gravado, o
 * telefone vazou por outra porta. Este teste manda um contato SEM
 * name/display_name e prova que o título vira o fallback neutro, nunca o
 * `phone_number`.
 */

const createLeadHandler = vi.fn();
const moveLeadHandler = vi.fn();
vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: (...args: unknown[]) => createLeadHandler(...args),
  moveLeadHandler: (...args: unknown[]) => moveLeadHandler(...args),
}));

import { getAction } from "@/lib/automation/actions";
import type { ActionCtx } from "@/lib/automation/types";
// Import por efeito colateral: registra "create_or_move_lead" no registry.
import "./create-or-move-lead";

function baseCtx(contact: Record<string, unknown>): ActionCtx {
  return {
    admin: {} as ActionCtx["admin"],
    organizationId: "org-1",
    ruleId: "rule-1",
    ruleName: "Regra de teste",
    requestId: "req-1",
    event: {} as ActionCtx["event"],
    context: { contact },
  };
}

describe("create_or_move_lead: título nunca vira telefone do contato", () => {
  beforeEach(() => {
    createLeadHandler.mockReset();
    moveLeadHandler.mockReset();
    createLeadHandler.mockResolvedValue({ id: "lead-novo" });
  });

  it("contato sem name/display_name: title cai no fallback neutro, não no telefone", async () => {
    const action = getAction("create_or_move_lead");
    expect(action).toBeDefined();

    const contact = { id: "contact-1", name: null, display_name: null, phone_number: "+5531999998888" };
    const result = await action!.execute(baseCtx(contact), { pipeline_id: "pipe-1", stage_id: "stage-1" });

    expect(result.status).toBe("success");
    expect(createLeadHandler).toHaveBeenCalledTimes(1);
    const input = createLeadHandler.mock.calls[0]![2] as { title: string };
    expect(input.title).toBe("Lead da automação");
    expect(input.title).not.toContain("+5531999998888");
  });

  it("contato com name: título continua sendo o nome (comportamento preservado)", async () => {
    const action = getAction("create_or_move_lead");
    const contact = { id: "contact-2", name: "Beltrano Souza", display_name: null, phone_number: "+5531999998888" };
    const result = await action!.execute(baseCtx(contact), { pipeline_id: "pipe-1", stage_id: "stage-1" });

    expect(result.status).toBe("success");
    const input = createLeadHandler.mock.calls[0]![2] as { title: string };
    expect(input.title).toBe("Beltrano Souza");
  });
});
