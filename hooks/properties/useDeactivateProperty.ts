"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Property } from "@/lib/types/properties";

export function useDeactivateProperty(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => apiClient.delete<{ data: Property }>(`/api/v1/properties/${id}`),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property", id] });
      qc.invalidateQueries({ queryKey: ["properties"] });
    },
  });
}
