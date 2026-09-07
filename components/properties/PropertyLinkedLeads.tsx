"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { X } from "@/lib/ui/icons";
import { usePropertyLeadLinks, useUnlinkLeadFromProperty } from "@/hooks/properties/usePropertyLeadLinks";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { LinkLeadDialog } from "./LinkLeadDialog";
import { useT } from "@/hooks/i18n/useT";

export function PropertyLinkedLeads({ propertyId }: { propertyId: string }) {
  const t = useT();
  const [dialogOpen, setDialogOpen] = useState(false);
  const q = usePropertyLeadLinks(propertyId);
  const unlink = useUnlinkLeadFromProperty(propertyId);
  const links = q.data?.data ?? [];
  // POST/DELETE /api/v1/properties/[id]/leads exigem role "agent" — sem
  // este gate o viewer via os controles de vínculo e só descobria o 403 ao
  // clicar.
  const canEdit = usePermission("property.update");

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Leads interessados</h3>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            Vincular lead
          </Button>
        )}
      </div>
      {q.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-error-fg">{t("Não foi possível carregar os leads vinculados.")}</p>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Nenhum lead vinculado ainda.")}</p>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.lead_id} className="flex items-center justify-between text-sm">
              <span>{l.crm_leads?.title ?? l.lead_id}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => unlink.mutate(l.lead_id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Desvincular"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <LinkLeadDialog propertyId={propertyId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  );
}
