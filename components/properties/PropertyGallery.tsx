"use client";
import { useRef } from "react";
import { Trash, Plus } from "@/lib/ui/icons";
import { useUploadPropertyMedia, useDeletePropertyMedia } from "@/hooks/properties/usePropertyMedia";
import { usePermission } from "@/hooks/auth/AuthProvider";
import type { PropertyMedia } from "@/lib/types/properties";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  propertyId: string;
  media: PropertyMedia[];
}

export function PropertyGallery({ propertyId, media }: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadPropertyMedia(propertyId);
  const remove = useDeletePropertyMedia(propertyId);
  // POST/DELETE /api/v1/properties/[id]/media exigem role "agent" — sem
  // este gate o viewer via os controles de foto e só descobria o 403 ao
  // clicar.
  const canEdit = usePermission("property.update");

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {media.map((m) => (
          <div key={m.id} className="group relative aspect-square overflow-hidden rounded-md border border-border">
            <img
              src={`/api/v1/properties/${propertyId}/media/${m.id}`}
              alt={t("Foto do imóvel")}
              className="h-full w-full object-cover"
            />
            {canEdit && (
              <button
                type="button"
                onClick={() => remove.mutate(m.id)}
                className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-1 text-white group-hover:block"
                aria-label="Remover foto"
              >
                <Trash className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="h-6 w-6" />
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
