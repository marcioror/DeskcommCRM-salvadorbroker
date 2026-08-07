"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Property, PropertyMedia } from "@/lib/types/properties";

interface PropertyResponse {
  data: Property & { media: PropertyMedia[] };
}

export function useProperty(id: string) {
  return useQuery({
    queryKey: ["property", id],
    enabled: !!id,
    queryFn: async () => {
      try {
        return await apiClient.get<PropertyResponse>(`/api/v1/properties/${id}`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}
