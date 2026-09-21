/**
 * Achado crítico da revisão final do módulo de Imóveis: `PropertyForm`
 * validava a edição contra `propertyCreateSchema` (schema de CRIAÇÃO, com
 * seus `.default(...)`s) mesmo com `initial` setado — o payload resultante
 * sempre incluía status/currency/address_country/furnished/accepts_pets no
 * valor-padrão de CRIAÇÃO, resetando silenciosamente esses campos em toda
 * edição (ex.: clicar "Desativar", depois "Editar" só pra corrigir um typo
 * no título, reativava o imóvel sem o usuário perceber).
 *
 * Este teste prova, do lado do CLIENTE, que editar só o título não inclui
 * esses campos no que é passado a `onSubmit`. É complementar (não
 * duplicado) ao teste server-side em
 * `app/api/v1/properties/[id]/route.test.ts`, que prova que a rota filtra
 * por `providedKeys` — aquele teste não pega este bug porque monta o body
 * do PATCH manualmente; a causa raiz vivia aqui, no form, que era quem de
 * fato colocava os defaults no body enviado.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PropertyForm } from "./PropertyForm";
import type { Property } from "@/lib/types/properties";

// Polyfills que o Radix Select exige e o jsdom não tem — mesmo padrão de
// app/app/team/_components/TeamMembersClient.test.tsx.
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    organization_id: "11111111-1111-1111-1111-111111111111",
    title: "Casa na praia",
    description: "Descrição original",
    property_type: "house",
    purpose: "sale",
    status: "inactive", // não-default de propósito — default de CRIAÇÃO é "available"
    price_sale_cents: 100000000,
    price_rent_cents: null,
    currency: "BRL",
    address_street: null,
    address_number: null,
    address_complement: null,
    address_neighborhood: null,
    address_city: "Florianópolis",
    address_state: "SC",
    address_zip: null,
    address_country: "BR",
    latitude: null,
    longitude: null,
    area_total_m2: 120,
    area_useful_m2: null,
    bedrooms: 3,
    bathrooms: 2,
    suites: null,
    parking_spots: 2,
    floor: null,
    construction_year: null,
    condo_fee_cents: null,
    iptu_cents: null,
    furnished: true, // não-default — default de CRIAÇÃO é false
    accepts_pets: true, // não-default — default de CRIAÇÃO é false
    features: ["piscina", "churrasqueira"],
    owner_user_id: null,
    created_by_user_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("PropertyForm — modo edição não vaza defaults de criação do Zod", () => {
  it("editar só o título não inclui status/currency/furnished/accepts_pets/address_country no payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initial = makeProperty();

    render(<PropertyForm initial={initial} onSubmit={onSubmit} />);

    const titleInput = screen.getByLabelText("Título");
    await user.clear(titleInput);
    await user.type(titleInput, "Casa na praia (reformada)");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const patch = onSubmit.mock.calls[0]![0] as Record<string, unknown>;

    expect(patch.title).toBe("Casa na praia (reformada)");
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("currency");
    expect(patch).not.toHaveProperty("furnished");
    expect(patch).not.toHaveProperty("accepts_pets");
    expect(patch).not.toHaveProperty("address_country");

    // Regressão positiva: `features` É um campo renderizado
    // ("Características"), então é esperado que apareça no patch — só não
    // deve ter sido resetado pro default de criação (`[]`).
    expect(patch.features).toEqual(["piscina", "churrasqueira"]);
  });

  it("modo criação (sem `initial`) continua incluindo os defaults do Zod", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<PropertyForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Título"), "Novo imóvel");
    await user.click(screen.getByRole("button", { name: "Cadastrar imóvel" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const created = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(created.status).toBe("available");
    expect(created.currency).toBe("BRL");
    expect(created.address_country).toBe("BR");
    expect(created.furnished).toBe(false);
    expect(created.accepts_pets).toBe(false);
  });
});
