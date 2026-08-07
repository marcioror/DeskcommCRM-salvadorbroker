"use client";
import { useState } from "react";
import { PencilSimple } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProperty } from "@/hooks/properties/useProperty";
import { useDeactivateProperty } from "@/hooks/properties/useDeactivateProperty";
import { PropertyGallery } from "@/components/properties/PropertyGallery";
import { PropertyLinkedLeads } from "@/components/properties/PropertyLinkedLeads";
import { EditPropertyDialog } from "@/components/properties/EditPropertyDialog";
import { usePermission } from "@/hooks/auth/AuthProvider";
import {
  PROPERTY_PURPOSE_LABEL,
  PROPERTY_STATUS_LABEL,
  PROPERTY_TYPE_LABEL,
} from "@/lib/types/properties";

export function PropertyDetailClient({ propertyId }: { propertyId: string }) {
  const [editOpen, setEditOpen] = useState(false);
  const q = useProperty(propertyId);
  const deactivate = useDeactivateProperty(propertyId);
  // PATCH/DELETE /api/v1/properties/[id] exigem role "agent" — sem este gate
  // o viewer via os botões, clicava e só descobria o 403 no submit (mesmo
  // padrão de gate client-side de "property.create" em
  // PropertiesListClient).
  const canEdit = usePermission("property.update");

  if (q.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (q.isError || !q.data?.data) {
    return (
      <div className="p-6">
        <Card className="p-6 text-center text-sm text-muted-foreground">Imóvel não encontrado.</Card>
      </div>
    );
  }

  const property = q.data.data;

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{property.title}</h1>
          <p className="text-sm text-muted-foreground">
            {property.address_city ?? "—"} {property.address_state ? `· ${property.address_state}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{PROPERTY_STATUS_LABEL[property.status]}</Badge>
          {canEdit && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <PencilSimple className="mr-2 h-4 w-4" /> Editar
            </Button>
          )}
          {canEdit && property.status !== "inactive" && (
            <Button variant="destructive" onClick={() => deactivate.mutate()} disabled={deactivate.isPending}>
              Desativar
            </Button>
          )}
        </div>
      </header>

      <Card className="p-4">
        <PropertyGallery propertyId={propertyId} media={property.media} />
      </Card>

      <Card className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Tipo</dt>
          <dd>{PROPERTY_TYPE_LABEL[property.property_type]}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Finalidade</dt>
          <dd>{PROPERTY_PURPOSE_LABEL[property.purpose]}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Quartos</dt>
          <dd>{property.bedrooms ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Banheiros</dt>
          <dd>{property.bathrooms ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Vagas</dt>
          <dd>{property.parking_spots ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Área</dt>
          <dd>{property.area_total_m2 ?? "—"} m²</dd>
        </div>
      </Card>

      {property.description && <Card className="p-4 text-sm">{property.description}</Card>}

      <PropertyLinkedLeads propertyId={propertyId} />

      <EditPropertyDialog property={property} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}
