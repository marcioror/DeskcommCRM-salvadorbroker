"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Property } from "@/lib/types/properties";

interface ListResponse {
  data: Property[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

export interface PropertyListFilters {
  search?: string;
  property_type?: string;
  purpose?: string;
  status?: string;
  city?: string;
}

export function usePropertyList(filters: PropertyListFilters) {
  return useInfiniteQuery({
    queryKey: ["properties", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
      if (pageParam) qs.set("cursor", pageParam);
      qs.set("limit", "50");
      try {
        return await apiClient.get<ListResponse>(`/api/v1/properties?${qs.toString()}`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    getNextPageParam: (lastPage) => (lastPage.meta?.has_more ? lastPage.meta.cursor : undefined),
  });
}
