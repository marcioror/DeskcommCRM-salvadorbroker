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
    // O mesmo vínculo (uma linha de crm_lead_links) é lido por dois lados —
    // esta tela (["property-leads", propertyId]) e o dossiê do lead
    // (["lead-properties", leadId], hooks/leads/useLeadInterestedProperties.ts).
    // Sem invalidar os dois, o lado que não disparou a mutação fica com
    // cache stale por até 30s (staleTime global, lib/query/client.ts) — achado
    // da revisão final.
    //
    // E o TERCEIRO lado é a timeline do lead, que a rota alimenta com
    // `property_linked` — ver o comentário longo no hook simétrico. Vale aqui
    // também: quem vincula pela tela do imóvel abre o dossiê do lead em
    // seguida, e o encontraria sem o registro.
    onSuccess: (_data, leadId) => {
      qc.invalidateQueries({ queryKey: ["property-leads", propertyId] });
      qc.invalidateQueries({ queryKey: ["lead-properties", leadId] });
      qc.invalidateQueries({ queryKey: ["timeline", leadId] });
    },
  });
}

export function useUnlinkLeadFromProperty(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) =>
      apiClient.delete(`/api/v1/properties/${propertyId}/leads/${leadId}`),
    onError: showApiError,
    // `property_unlinked` também vira atividade — mesma razão.
    onSuccess: (_data, leadId) => {
      qc.invalidateQueries({ queryKey: ["property-leads", propertyId] });
      qc.invalidateQueries({ queryKey: ["lead-properties", leadId] });
      qc.invalidateQueries({ queryKey: ["timeline", leadId] });
    },
  });
}
