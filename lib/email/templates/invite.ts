/**
 * Convite de time, em PT-BR, sem React Email. Devolve subject/html/text.
 * Estilo inline apenas (compatibilidade com cliente de e-mail); zero asset
 * externo.
 *
 * É o PRIMEIRO artefato que um usuário novo recebe do sistema — e chegava com
 * o nome do NOSSO produto em vez do da instalação que convidou. A marca entra
 * resolvida (`marcaDaSaida(organizationId)`, classe A: há organização), e as
 * cores deixam de ser hexes inventados aqui: o botão usa o accent derivado e o
 * resto vem dos neutros da régua do produto.
 */
import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";

export interface InviteEmailOptions {
  inviterName: string;
  orgName: string;
  acceptUrl: string;
  role: string;
  expiresAt: Date;
  /** A marca de quem convidou. Obrigatória — sem ela o e-mail não tem dono. */
  marca: MarcaDeSaida;
}

export function buildInviteEmail(opts: InviteEmailOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const expiresStr = opts.expiresAt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const marca = opts.marca.nome;
  const subject = `${opts.inviterName} convidou você para a ${opts.orgName} no ${marca}`;

  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">
      Você foi convidado para a ${escapeHtml(opts.orgName)}
    </h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
      ${escapeHtml(opts.inviterName)} convidou você como
      <strong>${escapeHtml(opts.role)}</strong> no ${escapeHtml(marca)}.
    </p>
    <p style="margin:24px 0">
      <a href="${opts.acceptUrl}" style="display:inline-block;padding:12px 24px;background:${opts.marca.accent};color:${opts.marca.accentFg};border-radius:6px;text-decoration:none;font-weight:600">
        Aceitar convite
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">
      Ou copie e cole este link no navegador:<br>
      <span style="word-break:break-all;color:${opts.marca.accent}">${opts.acceptUrl}</span>
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">
      Este link expira em <strong>${expiresStr}</strong>. Se você não esperava este convite, pode ignorá-lo.
    </p>
  </div>
</body>
</html>`;

  const text = [
    `Você foi convidado para a ${opts.orgName} como ${opts.role} no ${marca}.`,
    "",
    `Aceitar: ${opts.acceptUrl}`,
    "",
    `Expira em ${expiresStr}.`,
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
