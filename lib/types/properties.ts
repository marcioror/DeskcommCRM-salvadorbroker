export type PropertyType = "house" | "apartment" | "land" | "commercial" | "rural" | "other";
export type PropertyPurpose = "sale" | "rent" | "both";
export type PropertyStatus = "available" | "reserved" | "sold" | "rented" | "inactive";

export interface Property {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  property_type: PropertyType;
  purpose: PropertyPurpose;
  status: PropertyStatus;
  price_sale_cents: number | null;
  price_rent_cents: number | null;
  currency: string;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  address_country: string;
  latitude: number | null;
  longitude: number | null;
  area_total_m2: number | null;
  area_useful_m2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  suites: number | null;
  parking_spots: number | null;
  floor: number | null;
  construction_year: number | null;
  condo_fee_cents: number | null;
  iptu_cents: number | null;
  furnished: boolean;
  accepts_pets: boolean;
  features: string[];
  owner_user_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PropertyMedia {
  id: string;
  organization_id: string;
  property_id: string;
  storage_path: string;
  position: number;
  created_at: string;
  /** Anexado pela API, não é coluna — URL assinada de leitura. */
  signed_url?: string;
}

export interface PropertyLeadLinkView {
  lead_id: string;
  lead_title: string;
  linked_at: string;
}
