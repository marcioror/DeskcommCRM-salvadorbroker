"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface LinkedLead {
  lead_id: string;
  created_at: string;
  crm_leads: { id: string; title: string } | null;
}

export function usePropertyLeadLinks(propertyId: string) {
  return useQuery({
    queryKey: ["property-leads", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      try {
        return await apiClient.get<{ data: LinkedLead[] }>(`/api/v1/properties/${propertyId}/leads`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}

export function useLinkLeadToProperty(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) =>
      apiClient.post(`/api/v1/properties/${propertyId}/leads`, { lead_id: leadId }),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property-leads", propertyId] }),
  });
}

export function useUnlinkLeadFromProperty(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) =>
      apiClient.delete(`/api/v1/properties/${propertyId}/leads/${leadId}`),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property-leads", propertyId] }),
  });
}
