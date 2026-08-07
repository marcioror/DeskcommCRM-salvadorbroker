"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface LinkedProperty {
  target_id: string;
  created_at: string;
  properties: {
    id: string;
    title: string;
    status: string;
    price_sale_cents: number | null;
    price_rent_cents: number | null;
  } | null;
}

/**
 * Lê `GET /api/v1/leads/[id]/properties` (leitura simétrica à Task 6). O
 * vínculo/desvínculo em si reaproveita `POST`/`DELETE
 * /api/v1/properties/[id]/leads*` — mesmas mutações usadas em
 * `hooks/properties/usePropertyLeadLinks.ts`, não duplicadas aqui.
 */
export function useLeadInterestedProperties(leadId: string | null) {
  return useQuery({
    queryKey: ["lead-properties", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      try {
        return await apiClient.get<{ data: LinkedProperty[] }>(`/api/v1/leads/${leadId}/properties`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}

export function useLinkPropertyToLead(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (propertyId: string) =>
      apiClient.post(`/api/v1/properties/${propertyId}/leads`, { lead_id: leadId }),
    onError: showApiError,
    // Mesmo vínculo, duas telas — ver comentário simétrico em
    // hooks/properties/usePropertyLeadLinks.ts (achado da revisão final:
    // sem invalidar os dois lados, o outro fica com cache stale por até 30s).
    onSuccess: (_data, propertyId) => {
      qc.invalidateQueries({ queryKey: ["lead-properties", leadId] });
      qc.invalidateQueries({ queryKey: ["property-leads", propertyId] });
    },
  });
}

export function useUnlinkPropertyFromLead(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (propertyId: string) =>
      apiClient.delete(`/api/v1/properties/${propertyId}/leads/${leadId}`),
    onError: showApiError,
    onSuccess: (_data, propertyId) => {
      qc.invalidateQueries({ queryKey: ["lead-properties", leadId] });
      qc.invalidateQueries({ queryKey: ["property-leads", propertyId] });
    },
  });
}
