import type { LocalePack } from '@12-apps/i18n';

/**
 * The observability page's words, as the copy-portability doctrine states them.
 *
 * Every package in this repo that renders a sentence declares it as a typed
 * interface with NO defaults and ships a named pack per language, and every
 * other harness page gets its Portuguese from one of those:
 * `PT_BR_RESEARCH_MESSAGES`, `PT_BR_RBAC_WEB_COPY`, `PT_BR_WEB_STORAGE_MESSAGES`.
 * The host passes a pack; it never authors loose strings.
 *
 * `@12-apps/observability-frontend` ships none, and correctly — it renders
 * nothing. It attaches to three error funnels and sends events; there is no
 * screen in it to have words. So the words on this page are the HOST's, which
 * is precisely the case the doctrine is about: a host that hardcodes them has
 * frozen one language into a page and cannot be told, because a single-locale
 * app cannot tell the difference.
 *
 * Two locales rather than one, deliberately. A pack with a single entry is a
 * hardcoded string with extra steps — what proves the axis exists is a second
 * value that a switch actually reaches.
 */
export interface ObservabilityCopy {
  title: string;
  /** The three funnels the package attaches to. */
  uncaught: string;
  rejection: string;
  boundary: string;
  /** One report that is not a crash, and the three the noise filter drops. */
  warning: string;
  noise: string;
  staleChunk: string;
  ignorable: string;
  /** Who is reporting — two independent writers. */
  identify: string;
  impersonate: string;
}

export const PT_BR_OBSERVABILITY_COPY: ObservabilityCopy = {
  title: 'Relato de erros do navegador',
  uncaught: 'Erro não capturado',
  rejection: 'Promessa rejeitada',
  boundary: 'Falha de página',
  warning: 'Aviso sem quebra',
  noise: 'Ruído do navegador',
  staleChunk: 'Chunk morto',
  ignorable: 'Resposta 4xx',
  identify: 'Identificar a loja',
  impersonate: 'Entrar como outra loja',
};

export const EN_US_OBSERVABILITY_COPY: ObservabilityCopy = {
  title: 'Browser error reporting',
  uncaught: 'Uncaught error',
  rejection: 'Rejected promise',
  boundary: 'Page crash',
  warning: 'Warning, no crash',
  noise: 'Browser noise',
  staleChunk: 'Dead chunk',
  ignorable: '4xx response',
  identify: 'Name the store',
  impersonate: 'Act as another store',
};

/**
 * The two, keyed by tag.
 *
 * `LocalePack` is imported here rather than mirrored structurally, and that is
 * the difference between a HOST and a package: `core/pack.ts` explains that a
 * package declares a local structural twin so it stays liftable into a repo
 * that has never heard of `@12-apps/i18n`. This is the repo that has heard of
 * it — a host is the one place the real type belongs.
 */
export const OBSERVABILITY_COPY = {
  'pt-BR': PT_BR_OBSERVABILITY_COPY,
  'en-US': EN_US_OBSERVABILITY_COPY,
} as const satisfies LocalePack<ObservabilityCopy>;
