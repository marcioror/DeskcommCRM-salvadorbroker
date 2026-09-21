"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Property } from "@/lib/types/properties";
import type { PropertyPatch } from "@/lib/schemas/properties";

export function useUpdateProperty(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: PropertyPatch) =>
      apiClient.patch<{ data: Property }>(`/api/v1/properties/${id}`, patch),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property", id] });
      qc.invalidateQueries({ queryKey: ["properties"] });
    },
  });
}
