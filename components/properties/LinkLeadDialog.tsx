"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useLinkLeadToProperty } from "@/hooks/properties/usePropertyLeadLinks";
import { useT } from "@/hooks/i18n/useT";

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
  const t = useT();
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
          <DialogTitle>{t("Vincular lead")}</DialogTitle>
        </DialogHeader>
        <Input placeholder={t("Buscar lead pelo título...")} value={search} onChange={(e) => setSearch(e.target.value)} />
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
              {/* Elemento NÃO-interativo com aparência de botão, e são duas
                  razões somadas — a mesma dupla já resolvida no arquivo irmão
                  (`components/kanban/LinkPropertyDialog.tsx`), que este aqui
                  não acompanhou:

                  1. quem age é o botão da LINHA INTEIRA, que envolve isto. Um
                     controle interativo aqui dentro seria mudo — sem onClick,
                     parecendo ativo, com o cursor virando mãozinha e o clique
                     caindo no elemento de fora por acidente de propagação;
                  2. controle interativo dentro de controle interativo é HTML
                     inválido, e o navegador desfaz o aninhamento sozinho,
                     quebrando o layout de um jeito que não se reproduz lendo o
                     JSX.

                  `opacity-50` durante o envio é o mesmo sinal visual de antes;
                  o que sumiu é a promessa falsa de ser clicável. */}
              <span
                className={cn(
                  buttonVariants({ size: "sm", variant: "ghost" }),
                  link.isPending && "opacity-50",
                )}
              >
                {t("Vincular")}
              </span>
            </button>
          ))}
          {q.isError && (
            <p className="p-2 text-sm text-error-fg">
              {t("Não foi possível buscar leads agora. Tente novamente.")}
            </p>
          )}
          {!q.isError && search.length >= 2 && q.data?.data.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">{t("Nenhum lead encontrado.")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
