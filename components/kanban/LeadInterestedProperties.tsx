"use client";
import { useState } from "react";
import Link from "next/link";
import { X } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import {
  useLeadInterestedProperties,
  useUnlinkPropertyFromLead,
} from "@/hooks/leads/useLeadInterestedProperties";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { LinkPropertyDialog } from "./LinkPropertyDialog";

function formatBRL(cents: number | null): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

/**
 * Seção "Imóveis de interesse" do dossiê do lead — leitura de
 * `GET /api/v1/leads/[id]/properties`; vincular/desvincular reaproveita as
 * mesmas mutações da tela de detalhe do imóvel (mesmo vínculo, duas telas).
 */
export function LeadInterestedProperties({ leadId }: { leadId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const q = useLeadInterestedProperties(leadId);
  const unlink = useUnlinkPropertyFromLead(leadId);
  const items = q.data?.data ?? [];
  // POST/DELETE /api/v1/properties/[id]/leads exigem role "agent" — sem
  // este gate o viewer via os controles de vínculo e só descobria o 403 ao
  // clicar.
  const canEdit = usePermission("property.update");

  return (
    <section className="border-t border-border py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">Imóveis de interesse</h3>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setDialogOpen(true)}>
            Vincular
          </Button>
        )}
      </div>
      {q.isError ? (
        <div className="space-y-1">
          <p className="text-xs text-error-fg">Não foi possível carregar os imóveis vinculados.</p>
          <Button size="sm" variant="ghost" onClick={() => q.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-text-muted">Nenhum imóvel vinculado ainda.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) =>
            item.properties ? (
              <li key={item.target_id} className="flex items-center justify-between text-xs">
                <Link href={`/app/properties/${item.properties.id}`} className="hover:underline">
                  {item.properties.title}
                </Link>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-text-muted">
                    {formatBRL(item.properties.price_sale_cents ?? item.properties.price_rent_cents)}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => unlink.mutate(item.properties!.id)}
                      aria-label="Desvincular"
                      className="text-text-muted hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ) : null,
          )}
        </ul>
      )}
      <LinkPropertyDialog leadId={leadId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </section>
  );
}
