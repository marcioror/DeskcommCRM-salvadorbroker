// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { resolveSentryDsn, isCommunityDsn } from "./lib/sentry/dsn";
import { sentryScrubHooks } from "./lib/sentry/scrub";

const sentryDsn = resolveSentryDsn(
  typeof window !== "undefined" ? window.__PUBLIC_ENV__?.SENTRY_DSN : undefined,
);
const community = isCommunityDsn(sentryDsn);

Sentry.init({
  dsn: sentryDsn,

  integrations: [Sentry.replayIntegration()],

  // No Sentry da comunidade, só erro (issue #100): sem trace e sem replay de
  // sessão. O replay DE ERRO continua, porque é o que explica o stack trace —
  // e o replayIntegration() sem argumentos já aplica maskAllText/blockAllMedia.
  tracesSampleRate: community ? 0 : 1,
  enableLogs: true,

  replaysSessionSampleRate: community ? 0 : 0.1,
  replaysOnErrorSampleRate: 1.0,

  sendDefaultPii: false,

  ...sentryScrubHooks,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
