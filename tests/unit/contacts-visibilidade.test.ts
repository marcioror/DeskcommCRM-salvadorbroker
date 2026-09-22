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
