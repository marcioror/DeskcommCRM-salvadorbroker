"use client";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  propertyCreateSchema,
  propertyPatchSchema,
  type PropertyCreate,
  type PropertyPatch,
} from "@/lib/schemas/properties";
import { parseReaisToCents } from "@/lib/money";
import type { Property } from "@/lib/types/properties";
import { useT } from "@/hooks/i18n/useT";

interface FormShape {
  title: string;
  description: string;
  property_type: PropertyCreate["property_type"];
  purpose: PropertyCreate["purpose"];
  priceSaleReais: string;
  priceRentReais: string;
  address_city: string;
  address_state: string;
  bedrooms: string;
  bathrooms: string;
  parking_spots: string;
  area_total_m2: string;
  featuresRaw: string;
}

/**
 * Discriminada por `initial`: sem `initial` é criação (`onSubmit` recebe
 * `PropertyCreate`, com todos os defaults do Zod); com `initial` é edição
 * (`onSubmit` recebe `PropertyPatch`, só os campos que este form de fato
 * renderiza — ver comentário em `handleSubmit` sobre o achado da revisão
 * final: `propertyCreateSchema` vazava default de criação — status,
 * currency, address_country, furnished, accepts_pets — pro PATCH mesmo sem
 * o usuário ter tocado nesses campos).
 */
type Props =
  | { initial?: undefined; onSubmit: (input: PropertyCreate) => void; submitting?: boolean }
  | { initial: Property; onSubmit: (input: PropertyPatch) => void; submitting?: boolean };

/**
 * Centavos → "249,90" (sem prefixo de moeda) — pro campo de input reeditável.
 * `lib/money.ts` só tem a direção reais→centavos (`parseReaisToCents`) e
 * `formatCentsBRL` (com prefixo "R$", não editável de volta). Mesmo padrão
 * local usado em `LeadFieldsForm`/`EditLeadDialog`.
 */
function centsToReais(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function PropertyForm(props: Props) {
  const t = useT();
  const { initial, submitting } = props;
  const form = useForm<FormShape>({
    defaultValues: {
      title: initial?.title ?? "",
      description: initial?.description ?? "",
      property_type: initial?.property_type ?? "apartment",
      purpose: initial?.purpose ?? "sale",
      priceSaleReais: centsToReais(initial?.price_sale_cents),
      priceRentReais: centsToReais(initial?.price_rent_cents),
      address_city: initial?.address_city ?? "",
      address_state: initial?.address_state ?? "",
      bedrooms: initial?.bedrooms?.toString() ?? "",
      bathrooms: initial?.bathrooms?.toString() ?? "",
      parking_spots: initial?.parking_spots?.toString() ?? "",
      area_total_m2: initial?.area_total_m2?.toString() ?? "",
      featuresRaw: (initial?.features ?? []).join(", "),
    },
  });

  function handleSubmit(values: FormShape) {
    const features = values.featuresRaw
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    const priceSaleReais = values.priceSaleReais.trim();
    const priceRentReais = values.priceRentReais.trim();

    let priceSaleCents: number | undefined;
    if (priceSaleReais) {
      const parsed = parseReaisToCents(priceSaleReais);
      if (parsed === null) {
        form.setError("priceSaleReais", { message: "Valor inválido" });
        return;
      }
      priceSaleCents = parsed;
    }

    let priceRentCents: number | undefined;
    if (priceRentReais) {
      const parsed = parseReaisToCents(priceRentReais);
      if (parsed === null) {
        form.setError("priceRentReais", { message: "Valor inválido" });
        return;
      }
      priceRentCents = parsed;
    }

    const candidate = {
      title: values.title,
      description: values.description || undefined,
      property_type: values.property_type,
      purpose: values.purpose,
      price_sale_cents: priceSaleCents,
      price_rent_cents: priceRentCents,
      address_city: values.address_city || undefined,
      address_state: values.address_state || undefined,
      bedrooms: values.bedrooms ? Number(values.bedrooms) : undefined,
      bathrooms: values.bathrooms ? Number(values.bathrooms) : undefined,
      parking_spots: values.parking_spots ? Number(values.parking_spots) : undefined,
      area_total_m2: values.area_total_m2 ? Number(values.area_total_m2) : undefined,
      features,
    };

    if (initial) {
      const parsed = propertyPatchSchema.safeParse(candidate);
      if (!parsed.success) return;
      // `propertyPatchSchema` é `propertyCreateSchema.partial()`: campos com
      // `.default(...)` (status, currency, address_country, furnished,
      // accepts_pets) continuam recebendo o default do Zod pra qualquer
      // chave AUSENTE de `candidate` — este form não renderiza controle pra
      // eles. Sem este filtro, toda edição reescrevia silenciosamente
      // status/currency/etc pro valor-padrão de CRIAÇÃO (achado crítico da
      // revisão final do módulo). Mesmo padrão de `providedKeys` já usado em
      // PATCH /api/v1/properties/[id]/route.ts — mantém só as chaves que
      // `candidate` de fato define (os ~12 campos renderizados).
      const providedKeys = new Set(Object.keys(candidate));
      const patch = Object.fromEntries(
        Object.entries(parsed.data).filter(([key]) => providedKeys.has(key)),
      ) as PropertyPatch;
      props.onSubmit(patch);
      return;
    }

    const parsed = propertyCreateSchema.safeParse(candidate);
    if (!parsed.success) return;
    props.onSubmit(parsed.data);
  }

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="title">{t("Título")}</Label>
        <Input id="title" {...form.register("title", { required: true })} />
      </div>
      <div>
        <Label htmlFor="description">{t("Descrição")}</Label>
        <Textarea id="description" {...form.register("description")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Tipo</Label>
          <Select
            value={form.watch("property_type")}
            onValueChange={(v) => form.setValue("property_type", v as FormShape["property_type"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="house">Casa</SelectItem>
              <SelectItem value="apartment">Apartamento</SelectItem>
              <SelectItem value="land">Terreno</SelectItem>
              <SelectItem value="commercial">Comercial</SelectItem>
              <SelectItem value="rural">Rural</SelectItem>
              <SelectItem value="other">Outro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Finalidade</Label>
          <Select
            value={form.watch("purpose")}
            onValueChange={(v) => form.setValue("purpose", v as FormShape["purpose"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sale">Venda</SelectItem>
              <SelectItem value="rent">{t("Locação")}</SelectItem>
              <SelectItem value="both">{t("Venda e locação")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="priceSaleReais">{t("Preço de venda (R$)")}</Label>
          <Input id="priceSaleReais" placeholder="850.000,00" {...form.register("priceSaleReais")} />
          {form.formState.errors.priceSaleReais && (
            <p className="text-xs text-error-fg">{form.formState.errors.priceSaleReais.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="priceRentReais">{t("Preço de locação (R$)")}</Label>
          <Input id="priceRentReais" placeholder="3.500,00" {...form.register("priceRentReais")} />
          {form.formState.errors.priceRentReais && (
            <p className="text-xs text-error-fg">{form.formState.errors.priceRentReais.message}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="address_city">Cidade</Label>
          <Input id="address_city" {...form.register("address_city")} />
        </div>
        <div>
          <Label htmlFor="address_state">UF</Label>
          <Input id="address_state" maxLength={2} {...form.register("address_state")} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div>
          <Label htmlFor="bedrooms">Quartos</Label>
          <Input id="bedrooms" type="number" {...form.register("bedrooms")} />
        </div>
        <div>
          <Label htmlFor="bathrooms">{t("Banheiros")}</Label>
          <Input id="bathrooms" type="number" {...form.register("bathrooms")} />
        </div>
        <div>
          <Label htmlFor="parking_spots">Vagas</Label>
          <Input id="parking_spots" type="number" {...form.register("parking_spots")} />
        </div>
        <div>
          <Label htmlFor="area_total_m2">{t("Área (m²)")}</Label>
          <Input id="area_total_m2" type="number" {...form.register("area_total_m2")} />
        </div>
      </div>
      <div>
        <Label htmlFor="featuresRaw">{t("Características (separadas por vírgula)")}</Label>
        <Input id="featuresRaw" placeholder="piscina, elevador, varanda" {...form.register("featuresRaw")} />
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? t("Salvando…") : initial ? t("Salvar alterações") : t("Cadastrar imóvel")}
      </Button>
    </form>
  );
}
