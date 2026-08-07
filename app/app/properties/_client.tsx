"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, MagnifyingGlass } from "@/lib/ui/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePropertyList } from "@/hooks/properties/usePropertyList";
import { PropertyCard } from "@/components/properties/PropertyCard";
import { NewPropertyDialog } from "@/components/properties/NewPropertyDialog";

export function PropertiesListClient() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // Debounce search 250ms — mesmo padrão de ContactsListClient.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = useMemo(() => ({ search: search || undefined }), [search]);
  const q = usePropertyList(filters);
  const allProperties = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Imóveis</h1>
          <p className="text-sm text-muted-foreground">Cadastro de imóveis para venda e locação.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} weight="bold" aria-hidden />
          <span>Novo imóvel</span>
        </Button>
      </header>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2">
        <div className="relative w-full max-w-sm">
          <MagnifyingGlass
            size={16}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Buscar por título..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 pl-8"
          />
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-error-fg">Não foi possível carregar os imóveis.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => q.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : allProperties.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {search
            ? "Nenhum imóvel encontrado para essa busca."
            : 'Nenhum imóvel cadastrado ainda. Clique em "Novo imóvel" para começar.'}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allProperties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => q.fetchNextPage()}
                disabled={q.isFetchingNextPage}
              >
                {q.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
              </Button>
            </div>
          )}
        </>
      )}

      <NewPropertyDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
