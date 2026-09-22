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
