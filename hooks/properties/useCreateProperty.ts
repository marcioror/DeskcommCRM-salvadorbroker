"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Property } from "@/lib/types/properties";
import type { PropertyCreate } from "@/lib/schemas/properties";

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PropertyCreate) =>
      apiClient.post<{ data: Property }>("/api/v1/properties", input),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["properties"] }),
  });
}
