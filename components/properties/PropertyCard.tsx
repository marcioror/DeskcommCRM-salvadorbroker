"use client";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PROPERTY_STATUS_LABEL, type Property } from "@/lib/types/properties";

function formatBRL(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

export function PropertyCard({ property }: { property: Property }) {
  return (
    <Link href={`/app/properties/${property.id}`}>
      <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:border-primary">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium leading-tight">{property.title}</h3>
          <Badge variant="outline">{PROPERTY_STATUS_LABEL[property.status]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {property.address_city ?? "—"}
          {property.address_state ? ` · ${property.address_state}` : ""}
        </p>
        <div className="mt-auto flex items-center justify-between text-sm">
          <span className="font-medium tabular-nums">
            {property.purpose === "rent" ? formatBRL(property.price_rent_cents) : formatBRL(property.price_sale_cents)}
          </span>
          <span className="text-muted-foreground">
            {property.bedrooms ?? 0} qts · {property.bathrooms ?? 0} banh · {property.parking_spots ?? 0} vgs
          </span>
        </div>
      </Card>
    </Link>
  );
}
