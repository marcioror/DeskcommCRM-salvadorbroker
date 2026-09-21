"use client";

// `use client` explícito: o componente passou a usar `useT()`. Ele já só era
// importado por telas de cliente, mas depender disso é depender de quem
// importa — a primeira tela de servidor que o usasse quebraria em runtime,
// não no build.
import { Lock } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  valor: string | null;
  protegido: boolean;
}

/**
 * Telefone/e-mail de um lead que o corretor não cadastrou — protegido pela
 * regra em lib/contacts/visibility.ts. Nunca mostra nenhum dígito: o corretor
 * atende pelo chat do CRM, não pelo número.
 */
export function ContatoProtegido({ valor, protegido }: Props) {
  const t = useT();
  if (!protegido) return <>{valor ?? "—"}</>;
  return (
    <Badge
      variant="neutral"
      className="gap-1"
      title={t("Você não cadastrou este contato — atenda pelo chat do CRM.")}
    >
      <Lock size={10} weight="bold" aria-hidden />
      {t("Protegido")}
    </Badge>
  );
}
