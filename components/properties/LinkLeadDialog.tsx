"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useLinkLeadToProperty } from "@/hooks/properties/usePropertyLeadLinks";

interface LeadSearchResult {
  id: string;
  title: string;
}

interface Props {
  propertyId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * Busca de lead pra vínculo lead↔imóvel. Bate em `GET /api/v1/leads?search=`
 * (Task 11), que faz busca por título escopada à org ativa — não é o board
 * completo (`/api/v1/pipelines/[id]/board`), é uma lookup de autocomplete.
 */
export function LinkLeadDialog({ propertyId, open, onOpenChange }: Props) {
  const [search, setSearch] = useState("");
  const link = useLinkLeadToProperty(propertyId);

  const q = useQuery({
    queryKey: ["lead-search", search],
    enabled: open && search.length >= 2,
    retry: false,
    queryFn: async () =>
      apiClient.get<{ data: LeadSearchResult[] }>(`/api/v1/leads?search=${encodeURIComponent(search)}&limit=10`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular lead</DialogTitle>
        </DialogHeader>
        <Input placeholder="Buscar lead pelo título..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {(q.data?.data ?? []).map((lead) => (
            <button
              key={lead.id}
              type="button"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() =>
                link.mutate(lead.id, {
                  onSuccess: () => onOpenChange(false),
                })
              }
            >
              <span>{lead.title}</span>
              <Button size="sm" variant="ghost" disabled={link.isPending}>
                Vincular
              </Button>
            </button>
          ))}
          {q.isError && (
            <p className="p-2 text-sm text-error-fg">
              Não foi possível buscar leads agora. Tente novamente.
            </p>
          )}
          {!q.isError && search.length >= 2 && q.data?.data.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">Nenhum lead encontrado.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
