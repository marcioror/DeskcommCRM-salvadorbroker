import { describe, it, expect } from "vitest";
import { propertyCreateSchema, propertyPatchSchema, propertyLeadLinkSchema } from "./properties";

describe("propertyCreateSchema", () => {
  it("aceita um payload mínimo válido", () => {
    const parsed = propertyCreateSchema.safeParse({
      title: "Apto 2 quartos Centro",
      property_type: "apartment",
      purpose: "sale",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejeita title vazio", () => {
    const parsed = propertyCreateSchema.safeParse({
      title: "",
      property_type: "apartment",
      purpose: "sale",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita property_type fora da lista", () => {
    const parsed = propertyCreateSchema.safeParse({
      title: "X",
      property_type: "castle",
      purpose: "sale",
    });
    expect(parsed.success).toBe(false);
  });

  it("aceita features como array de strings e preços em cents", () => {
    const parsed = propertyCreateSchema.safeParse({
      title: "Casa com piscina",
      property_type: "house",
      purpose: "both",
      price_sale_cents: 85000000,
      price_rent_cents: 350000,
      features: ["piscina", "elevador"],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("propertyPatchSchema", () => {
  it("aceita patch parcial só com status", () => {
    const parsed = propertyPatchSchema.safeParse({ status: "reserved" });
    expect(parsed.success).toBe(true);
  });
});

describe("propertyLeadLinkSchema", () => {
  it("exige lead_id como uuid", () => {
    expect(propertyLeadLinkSchema.safeParse({ lead_id: "not-a-uuid" }).success).toBe(false);
    expect(
      propertyLeadLinkSchema.safeParse({ lead_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" }).success,
    ).toBe(true);
  });
});
