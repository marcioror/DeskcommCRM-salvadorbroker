import { Lock } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";

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
  if (!protegido) return <>{valor ?? "—"}</>;
  return (
    <Badge variant="neutral" className="gap-1" title="Você não cadastrou este contato — atenda pelo chat do CRM.">
      <Lock size={10} weight="bold" aria-hidden />
      Protegido
    </Badge>
  );
}
