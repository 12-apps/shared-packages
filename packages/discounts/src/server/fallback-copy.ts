import { isPortuguese, languageTagOf, nearestPack } from "../pack-language";

import type { DiscountsServerCopy, DiscountsServerFallbackKey } from "./copy";
import { EN_US_DISCOUNTS_SERVER_COPY } from "./en-US";
import { PT_BR_DISCOUNTS_SERVER_COPY } from "./pt-BR";

/**
 * The sentences a host's pack may leave out (review round 6): added after the
 * pack became host config, so requiring them would break every host that
 * wrote its own. A pack that has one says it; one that lacks it is answered
 * in the package's own pack for the request's language — pt-BR for a `pt`
 * tag (`pt_BR` included), en-US for any other. A request with no language is
 * answered in the language of the host's own pack (round 7): a server pack
 * declares no locale, so the package's pack it shares more sentences with
 * decides, en-US on a tie (`nearestPack`).
 */
export function fallbackSentence(
  copy: DiscountsServerCopy,
  key: DiscountsServerFallbackKey,
  locale: string | null | undefined,
): string {
  const own = copy[key];
  if (typeof own === "string" && own.trim() !== "") return own;
  const tag = languageTagOf(locale);
  if (tag !== undefined) return (isPortuguese(tag) ? PT_BR_DISCOUNTS_SERVER_COPY : EN_US_DISCOUNTS_SERVER_COPY)[key];
  return nearestPack(copy, PT_BR_DISCOUNTS_SERVER_COPY, EN_US_DISCOUNTS_SERVER_COPY)[key];
}
