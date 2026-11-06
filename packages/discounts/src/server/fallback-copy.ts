import type { DiscountsServerCopy, DiscountsServerFallbackKey } from "./copy";
import { EN_US_DISCOUNTS_SERVER_COPY } from "./en-US";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "./pt-BR";

/**
 * The sentences a host's pack may leave out (review round 6): added after the
 * pack became host config, so requiring them would break every host that
 * wrote its own. A pack that has one says it; one that lacks it is answered
 * in the package's own pack for the request's language — pt-BR for a `pt`
 * tag, en-US for any other or none.
 */
export function fallbackSentence(
  copy: DiscountsServerCopy,
  key: DiscountsServerFallbackKey,
  locale: string | null | undefined,
): string {
  const own = copy[key];
  if (typeof own === "string" && own.trim() !== "") return own;
  const pack = /^pt(?:-|$)/iu.test(locale ?? "") ? PT_BR_DISCOUNTS_SERVER_COPY : EN_US_DISCOUNTS_SERVER_COPY;
  return pack[key];
}
