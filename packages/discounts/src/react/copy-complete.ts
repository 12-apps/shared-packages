import type { DiscountsFormCopy, DiscountsWebCopy, DiscountsWindowCopy } from "./copy";

/**
 * The complete shape of a pack, split from `./copy` for the file-size gate;
 * `./copy` re-exports both types.
 */
/** The window keys a host's pack may leave out (review round 6). */
export type DiscountsWindowFallbackKey =
  | "daysUnknown"
  | "daysUnknownList"
  | "daysUnknownForm"
  | "daysUnknownBoxes"
  | "daysUnknownPaused"
  | "datesLockedForm"
  | "datesLockedBoxes"
  | "openTimeZone";

/**
 * A pack that says every sentence, the optional ones included — the package's
 * own two, and what `createWebDiscounts` hands its screens once it has filled
 * a host's pack in.
 */
export type CompleteDiscountsWebCopy = Omit<DiscountsWebCopy, "window" | "form"> & {
  readonly window: DiscountsWindowCopy & Required<Pick<DiscountsWindowCopy, DiscountsWindowFallbackKey>>;
  readonly form: Omit<DiscountsFormCopy, "calendar" | "endsBeforeStartDay"> & {
    readonly calendar: Required<NonNullable<DiscountsFormCopy["calendar"]>>;
    readonly endsBeforeStartDay: string;
  };
};
