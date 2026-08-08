/**
 * DSN do Sentry com opt-out em runtime — modelo "telemetria de comunidade".
 *
 * Por padrão, erros vão pro Sentry do projeto (DEFAULT_SENTRY_DSN): num open source
 * self-host, é o que dá visibilidade pra corrigir bugs que afetam todo mundo. Quem
 * hospeda controla isso pelo `.env`, SEM rebuild da imagem:
 *
 *   SENTRY_DSN=off           → desliga toda a telemetria (nada é enviado)
 *   SENTRY_DSN=<seu-dsn>     → manda os erros pro SEU Sentry
 *   SENTRY_DSN=  (vazio)     → usa o Sentry da comunidade (padrão)
 *
 * Vale para servidor (process.env) e navegador (window.__PUBLIC_ENV__.SENTRY_DSN,
 * injetado em runtime pelo <PublicEnvScript/>). O DSN não é segredo — DSNs do Sentry
 * são públicos por design.
 */
export const DEFAULT_SENTRY_DSN =
  "https://58fabf8ad54504863d404a3647ef3714@o4509908078559232.ingest.us.sentry.io/4509908083212288";

export function resolveSentryDsn(value: string | undefined | null): string | undefined {
  const v = (value ?? "").trim().toLowerCase() === "off" ? "off" : (value ?? "").trim();
  if (v === "off" || v === "false" || v === "0") return undefined;
  return v.length > 0 ? v : DEFAULT_SENTRY_DSN;
}

/**
 * Estamos mandando para o Sentry da COMUNIDADE (o nosso), e não para o do operador?
 *
 * Isso decide a amostragem (issue #100). No DSN da comunidade só vai ERRO:
 * `tracesSampleRate` e `replaysSessionSampleRate` vão a 0. O que ajuda a corrigir
 * "bug que afeta todo mundo" é o stack trace — não 100% das transações nem 10% das
 * sessões de um CRM que não é nosso. Quem aponta para o próprio Sentry recebe tudo,
 * porque aí o dado não sai da infraestrutura de quem é dono dele.
 */
export function isCommunityDsn(dsn: string | undefined): boolean {
  return dsn === DEFAULT_SENTRY_DSN;
}
