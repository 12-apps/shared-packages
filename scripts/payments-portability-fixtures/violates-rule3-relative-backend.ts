/**
 * Rule 3, reached by the OTHER name a backend import can arrive under.
 *
 * In this repo `packages/payments/frontend` and `.../backend` are siblings on
 * disk, so a relative climb pulls the same server code — and the same
 * `node:crypto` — into a browser bundle while never spelling
 * `@12-apps/payments-backend`. A rule that matched only the package string
 * called this file clean, which is why it is pinned here: the rule is about
 * where the import LANDS, not how it is spelled.
 */
import { providerCatalog } from "../../backend/src/core/catalog";
import registry from "../../backend/src/core/registry";

export const count = providerCatalog.length + Number(Boolean(registry));
