import { assertTargetsOwned } from "./collections";
import { wholeDayCopyFor, zoneFor } from "./calendar-days";
import { resolveDiscountsCopy, type DiscountsServerCopy } from "./copy";
import { fallbackSentence } from "./fallback-copy";
import type { DiscountsApiConfig } from "./routes";
import { keepsWindow, sendsDates, type SentDays } from "./update-window";
import {
  DiscountValidationError,
  targetsForScope,
  toDiscountScalars,
  toDiscountWriteInput,
  type DiscountWriteBody,
  type DiscountWriteInput,
} from "./validate";
import { checkedWholeDays, unplaceableDays } from "./validate-window";

/** Split from `./routes` for the file-size gate: the one fold both writes share. */

/** Review round 6 (N1): keep the window AND change it is not one edit. */
function assertKeepsOnly(sent: SentDays, copy: DiscountsServerCopy, locale: string | undefined): void {
  if (!sendsDates(sent)) return;
  throw new DiscountValidationError("keepWindow", fallbackSentence(copy, "keepWindowWithDates", locale));
}

/**
 * An update's date-field 422 on an unknown zone, HELD for the row (review
 * round 6): days equal to the ones a read showed are no change, and save.
 */
function heldRefusal(
  write: "create" | "update",
  sent: DiscountWriteInput,
  copy: DiscountsServerCopy,
  timeZone: string | undefined,
): DiscountValidationError | null {
  if (write !== "update" || timeZone === undefined) return null;
  return unplaceableDays(checkedWholeDays(sent, copy), copy, timeZone);
}

/**
 * Fold a validated body into what the store persists, and refuse a target that
 * is not this tenant's.
 *
 * Both writes go through it, so the rules run exactly once per write and a
 * second caller cannot half-apply them. The ownership check is here rather than
 * in each route for the same reason, and it runs AFTER the fold because the
 * fold is what narrows the targets to the scope — checking the raw body would
 * reject ids a COMBO-scoped write was about to drop anyway.
 */
export async function prepareWrite(
  config: DiscountsApiConfig,
  copy: DiscountsServerCopy,
  clientId: string,
  body: unknown,
  write: "create" | "update",
  locale?: string,
) {
  // `keepWindow` (an update's only, review round 5): the STORED dates are put
  // back by the update, so none is read here and no zone is asked.
  const keepWindow = write === "update" && keepsWindow(body);
  const sent = toDiscountWriteInput(body as DiscountWriteBody);
  const sentDays = { startsAt: sent.startsAt, endsAt: sent.endsAt };
  if (keepWindow) assertKeepsOnly(sentDays, copy, locale);
  const timeZone = keepWindow ? undefined : await zoneFor(config.storeTimeZone, clientId);
  const dayCopy =
    timeZone === undefined ? copy : wholeDayCopyFor(copy, resolveDiscountsCopy(config.copy, undefined));
  const refusal = heldRefusal(write, sent, dayCopy, timeZone);
  const input = keepWindow || refusal !== null ? { ...sent, startsAt: null, endsAt: null } : sent;
  const scalars =
    timeZone === undefined ? toDiscountScalars(input, copy) : toDiscountScalars(input, dayCopy, { timeZone });
  const folded = { scalars, targets: targetsForScope(input) };
  if (config.collections) {
    await assertTargetsOwned(config.collections, clientId, folded.targets, copy.foreignTarget);
  }
  // A legacy row (flag false) whose dates change while the zone is unknown is
  // written as legacy UTC midnights, its own meaning, which needs no zone
  // (review round 7, ADR 0186): built only if the row read turns out legacy.
  const legacy = refusal === null ? null : () => ({ scalars: toDiscountScalars(sent, copy), targets: folded.targets });
  return { write: folded, timeZone, sent: sentDays, keepWindow, refusal, legacy };
}
