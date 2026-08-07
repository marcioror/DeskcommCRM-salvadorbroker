"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { ApiError } from "@/lib/api/types";
import type { PropertyMedia } from "@/lib/types/properties";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data?: T; error?: { code: string; message: string } };
  if (!res.ok || !body.data) {
    throw new ApiError(res.status, body.error?.code ?? "unknown_error", undefined, "", body.error?.message);
  }
  return body.data;
}

export function useUploadPropertyMedia(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/v1/properties/${propertyId}/media`, { method: "POST", body: form });
      return parseJsonOrThrow<PropertyMedia>(res);
    },
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property", propertyId] }),
  });
}

export function useDeletePropertyMedia(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mediaId: string) => {
      const res = await fetch(`/api/v1/properties/${propertyId}/media/${mediaId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json()) as { error?: { code: string; message: string } };
        throw new ApiError(res.status, body.error?.code ?? "unknown_error", undefined, "", body.error?.message);
      }
    },
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property", propertyId] }),
  });
}
