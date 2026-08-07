"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PropertyForm } from "./PropertyForm";
import { useUpdateProperty } from "@/hooks/properties/useUpdateProperty";
import type { Property } from "@/lib/types/properties";
import type { PropertyCreate } from "@/lib/schemas/properties";

interface Props {
  property: Property;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function EditPropertyDialog({ property, open, onOpenChange }: Props) {
  const update = useUpdateProperty(property.id);

  function handleSubmit(input: PropertyCreate) {
    update.mutate(input, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar imóvel</DialogTitle>
        </DialogHeader>
        <PropertyForm initial={property} onSubmit={handleSubmit} submitting={update.isPending} />
      </DialogContent>
    </Dialog>
  );
}
