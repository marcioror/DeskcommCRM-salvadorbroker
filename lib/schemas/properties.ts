import { z } from "zod";

const PROPERTY_TYPES = ["house", "apartment", "land", "commercial", "rural", "other"] as const;
const PURPOSES = ["sale", "rent", "both"] as const;
const STATUSES = ["available", "reserved", "sold", "rented", "inactive"] as const;

export const propertyCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  property_type: z.enum(PROPERTY_TYPES),
  purpose: z.enum(PURPOSES),
  status: z.enum(STATUSES).default("available"),

  price_sale_cents: z.number().int().nonnegative().optional(),
  price_rent_cents: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).default("BRL"),

  address_street: z.string().max(200).optional(),
  address_number: z.string().max(20).optional(),
  address_complement: z.string().max(100).optional(),
  address_neighborhood: z.string().max(100).optional(),
  address_city: z.string().max(100).optional(),
  address_state: z.string().max(2).optional(),
  address_zip: z.string().max(9).optional(),
  address_country: z.string().length(2).default("BR"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),

  area_total_m2: z.number().positive().optional(),
  area_useful_m2: z.number().positive().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  suites: z.number().int().nonnegative().optional(),
  parking_spots: z.number().int().nonnegative().optional(),
  floor: z.number().int().optional(),
  construction_year: z.number().int().min(1800).max(2100).optional(),
  condo_fee_cents: z.number().int().nonnegative().optional(),
  iptu_cents: z.number().int().nonnegative().optional(),
  furnished: z.boolean().default(false),
  accepts_pets: z.boolean().default(false),

  features: z.array(z.string().min(1).max(50)).max(50).default([]),
  owner_user_id: z.string().uuid().optional(),
});
export type PropertyCreate = z.infer<typeof propertyCreateSchema>;

export const propertyPatchSchema = propertyCreateSchema.partial();
export type PropertyPatch = z.infer<typeof propertyPatchSchema>;

export const propertyListQuerySchema = z.object({
  search: z.string().optional(),
  property_type: z.enum(PROPERTY_TYPES).optional(),
  purpose: z.enum(PURPOSES).optional(),
  status: z.enum(STATUSES).optional(),
  price_min_cents: z.coerce.number().int().nonnegative().optional(),
  price_max_cents: z.coerce.number().int().nonnegative().optional(),
  city: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PropertyListQuery = z.infer<typeof propertyListQuerySchema>;

export const propertyLeadLinkSchema = z.object({
  lead_id: z.string().uuid(),
});
export type PropertyLeadLink = z.infer<typeof propertyLeadLinkSchema>;
