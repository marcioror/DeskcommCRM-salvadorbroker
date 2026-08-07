"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { X } from "@/lib/ui/icons";
import { usePropertyLeadLinks, useUnlinkLeadFromProperty } from "@/hooks/properties/usePropertyLeadLinks";
import { LinkLeadDialog } from "./LinkLeadDialog";

export function PropertyLinkedLeads({ propertyId }: { propertyId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const q = usePropertyLeadLinks(propertyId);
  const unlink = useUnlinkLeadFromProperty(propertyId);
  const links = q.data?.data ?? [];

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Leads interessados</h3>
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
          Vincular lead
        </Button>
      </div>
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum lead vinculado ainda.</p>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.lead_id} className="flex items-center justify-between text-sm">
              <span>{l.crm_leads?.title ?? l.lead_id}</span>
              <button
                type="button"
                onClick={() => unlink.mutate(l.lead_id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Desvincular"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <LinkLeadDialog propertyId={propertyId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  );
}
