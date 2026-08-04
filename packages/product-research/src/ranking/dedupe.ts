import type { ScoredOffer } from '../types';

/**
 * Cross-source dedupe (FUT-419): the same listing arriving through two
 * connectors — an amazon.com.br product via both the AMAZON connector and
 * Google Shopping — must appear once. Identity is the NORMALIZED offer URL:
 * for Amazon-family hosts the ASIN embedded in the path (the marketplace's
 * own identity, stable across slugs and affiliate/tracking params), for
 * every other host the URL with tracking params stripped. Offers without a
 * usable URL never collapse — absence of identity is not sameness.
 *
 * Runs on the RANKED list and keeps the FIRST occurrence, so the ranking
 * arithmetic (cheapest realizable unit cost, ETA tie-break) — never the
 * source — decides which duplicate survives. Ranks are renumbered so the
 * surviving sequence stays 1..n.
 */

const AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$/;

// The listing-page shapes amazon deep links actually take: /dp/<ASIN>,
// /gp/product/<ASIN>, /gp/aw/d/<ASIN> (mobile), optionally behind a slug.
const ASIN_IN_PATH = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?=[/?#]|$)/i;

// Marketing/affiliate noise that varies per click on the SAME listing:
// utm_*, Google Shopping's srsltid, gclid/fbclid, amazon's ref_/tag/linkCode.
const TRACKING_PARAM = /^(utm_|srsltid$|gclid$|fbclid$|ref_?$|tag$|linkCode$|ascsubtag$)/i;

/** The identity key an offer dedupes on, or null when it has none. */
export const offerIdentity = (url: string | undefined): string | null => {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (AMAZON_HOST.test(host)) {
    const asin = ASIN_IN_PATH.exec(parsed.pathname)?.[1];
    // Host stays in the key: the same ASIN on amazon.com.br and amazon.com
    // is two different offers (marketplace, currency, freight).
    if (asin) return `${host}/asin/${asin.toUpperCase()}`;
  }
  const params = [...parsed.searchParams.entries()]
    .filter(([name]) => !TRACKING_PARAM.test(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${host}${path}${params ? `?${params}` : ''}`;
};

export const dedupeOffers = (ranked: ScoredOffer[]): ScoredOffer[] => {
  const seen = new Set<string>();
  const kept = ranked.filter((offer) => {
    const identity = offerIdentity(offer.url);
    if (identity === null) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  if (kept.length === ranked.length) return ranked;
  return kept.map((offer, index) => ({ ...offer, rank: index + 1 }));
};
