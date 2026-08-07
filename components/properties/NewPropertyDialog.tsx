"use client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PropertyForm } from "./PropertyForm";
import { useCreateProperty } from "@/hooks/properties/useCreateProperty";
import type { PropertyCreate } from "@/lib/schemas/properties";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function NewPropertyDialog({ open, onOpenChange }: Props) {
  const create = useCreateProperty();

  async function handleSubmit(input: PropertyCreate) {
    try {
      await create.mutateAsync(input);
      toast.success("Imóvel cadastrado");
      onOpenChange(false);
    } catch {
      // error toast já é disparado pelo hook (showApiError)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo imóvel</DialogTitle>
        </DialogHeader>
        <PropertyForm onSubmit={handleSubmit} submitting={create.isPending} />
      </DialogContent>
    </Dialog>
  );
}
