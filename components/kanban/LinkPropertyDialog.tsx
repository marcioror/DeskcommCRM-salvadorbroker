"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useLinkPropertyToLead } from "@/hooks/leads/useLeadInterestedProperties";
import { useT } from "@/hooks/i18n/useT";

interface PropertySearchResult {
  id: string;
  title: string;
}

interface Props {
  leadId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * Busca de imóvel pra vínculo lead↔imóvel. Bate em `GET /api/v1/properties?search=`
 * (Task 3, já existe desde o início do módulo) — mesma forma da busca simétrica
 * em `components/properties/LinkLeadDialog.tsx`.
 */
export function LinkPropertyDialog({ leadId, open, onOpenChange }: Props) {
  const t = useT();
  const [search, setSearch] = useState("");
  const link = useLinkPropertyToLead(leadId);

  const q = useQuery({
    queryKey: ["property-search", search],
    enabled: open && search.length >= 2,
    retry: false,
    queryFn: async () =>
      apiClient.get<{ data: PropertySearchResult[] }>(
        `/api/v1/properties?search=${encodeURIComponent(search)}&limit=10`,
      ),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Vincular imóvel")}</DialogTitle>
        </DialogHeader>
        <Input placeholder={t("Buscar imóvel pelo título...")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {(q.data?.data ?? []).map((property) => (
            <button
              key={property.id}
              type="button"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => link.mutate(property.id, { onSuccess: () => onOpenChange(false) })}
            >
              <span>{property.title}</span>
              {/* Rótulo com aparência de botão: já está dentro do controle da
                  linha inteira, e aninhar interativo em interativo é HTML
                  inválido.

                  ⚠️ O NOME DO COMPONENTE DE BOTÃO NÃO SE ESCREVE AQUI, NEM EM
                  PROSA. A varredura de `tests/unit/controle-decorativo.test.ts`
                  casa a abertura da tag desse componente no TEXTO do arquivo,
                  comentário incluído — e acusava esta
                  linha, um comentário, como botão mudo. Nada de errado com a
                  varredura: é o mesmo cuidado que `push.handler.ts` e
                  `varredura-anon-e-o-ultimo-bloco` já documentam. Instrumento
                  estático reprovando o arquivo por ele falar de si mesmo é
                  ruído que treina todo mundo a ignorar vermelho. */}
              <span
                className={cn(buttonVariants({ size: "sm", variant: "ghost" }), link.isPending && "opacity-50")}
              >
                {t("Vincular")}
              </span>
            </button>
          ))}
          {q.isError && (
            <p className="p-2 text-sm text-error-fg">
              {t("Não foi possível buscar imóveis agora. Tente novamente.")}
            </p>
          )}
          {!q.isError && search.length >= 2 && q.data?.data.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">{t("Nenhum imóvel encontrado.")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
