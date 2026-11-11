/**
 * The words of the form as collapsing steps (FUT-4475): the four step cards,
 * their done lines, the "Resumo" beside them, the chrome on top (the state
 * pill, the pendências and the status strip) and the leave confirmation.
 *
 * Its own interface because `copy.ts` sits at the file-size gate. Every key is
 * required: `assertConfig` reads the pt-BR pack's leaves, so a host shipping
 * its own pack is told which of these it lacks.
 */

/** The step a key or a pendência belongs to, by name rather than number. */
export interface DiscountsStepWhereCopy {
  readonly identity: string;
  readonly targets: string;
  readonly price: string;
  readonly rules: string;
}

/** The word for each missing thing in a "Falta: …" line. */
export interface DiscountsStepShortNamesCopy {
  readonly name: string;
  readonly oneGroup: string;
  readonly quantity: string;
  readonly groupTargets: string;
  readonly products: string;
  readonly freeUnits: string;
  readonly scope: string;
  readonly value: string;
  readonly comboCap: string;
  readonly code: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly oneWindow: string;
  readonly schedule: string;
  readonly usageLimit: string;
  readonly perBuyerLimit: string;
}

/** The answer and muted line of a done card, and the "Resumo" sentence. */
export interface DiscountsStepSummaryCopy {
  readonly kindAndName: string;
  readonly comboParts: string;
  readonly part: string;
  readonly or: string;
  readonly plus: string;
  readonly nothing: string;
  readonly freeLine: string;
  readonly wholeOrder: string;
  readonly categories: string;
  readonly products: string;
  readonly list: string;
  readonly labelled: string;
  readonly detailSeparator: string;
  readonly comboCap: string;
  readonly freeCap: string;
  readonly capCount: string;
  readonly capAny: string;
  readonly sentenceCombo: string;
  /** A combo whose reward has no value yet: the sentence stops before it, never on "…". */
  readonly sentenceComboNoReward: string;
  readonly sentencePrice: string;
  readonly sentencePercent: string;
  readonly sentenceAmount: string;
  readonly sentenceFree: string;
  readonly sentenceFreeProducts: string;
  readonly sentencePlain: string;
  /** A percentage or amount with no value yet: the sentence never starts on "…". */
  readonly sentencePlainNoValue: string;
  readonly sentenceWholeOrder: string;
  readonly sentenceTargets: string;
}

/** The rule chips: the "Resumo", step 4's done line and the status strip. */
export interface DiscountsStepChipsCopy {
  readonly automatic: string;
  readonly coupon: string;
  readonly couponNoCode: string;
  readonly everyDay: string;
  readonly window: string;
  readonly minSubtotal: string;
  readonly usage: string;
  readonly perBuyer: string;
  readonly noLimits: string;
  readonly withLimits: string;
  readonly firstOrder: string;
  readonly anyBuyer: string;
  readonly stackable: string;
  readonly exclusive: string;
  readonly active: string;
  readonly paused: string;
  readonly withSchedule: string;
}

/** The block over the steps: pill, pendências, strip; and the leave confirmation. */
export interface DiscountsStepChromeCopy {
  readonly unsaved: string;
  readonly saved: string;
  readonly dirty: string;
  readonly issuesOne: string;
  readonly issuesOther: string;
  readonly issuesRegion: string;
  readonly issuesFoot: string;
  readonly groupIssue: string;
  readonly where: DiscountsStepWhereCopy;
  readonly strip: string;
  readonly leaveTitle: string;
  readonly leaveBody: string;
  readonly leaveStay: string;
  readonly leaveDiscard: string;
}

export interface DiscountsStepsCopy {
  /** The `<ol>`'s accessible name. */
  readonly list: string;
  readonly identity: string;
  readonly comboTargets: string;
  readonly freeTargets: string;
  readonly plainTargets: string;
  readonly freeTimes: string;
  readonly price: string;
  readonly rules: string;
  /** A done card's small line: "{number} · {name}". */
  readonly caption: string;
  readonly next: string;
  readonly finish: string;
  readonly change: string;
  /** A done card's accessible name: "Alterar {name}". */
  readonly changeLabel: string;
  readonly seeAll: string;
  readonly backToSteps: string;
  /** "Falta: {names}". */
  readonly missing: string;
  readonly missingSeparator: string;
  readonly short: DiscountsStepShortNamesCopy;
  readonly submitUnreached: string;
  readonly submitIssuesCreate: string;
  readonly submitIssuesEdit: string;
  readonly submitUnchanged: string;
  readonly rulesIntro: string;
  readonly rulesDone: string;
  readonly limitsTitle: string;
  readonly wholeOrderNote: string;
  readonly kindExamples: {
    readonly PERCENTAGE: string;
    readonly FIXED_AMOUNT: string;
    readonly COMBO: string;
    readonly FREE_UNITS: string;
  };
  readonly resumo: string;
  readonly summary: DiscountsStepSummaryCopy;
  readonly chips: DiscountsStepChipsCopy;
  readonly chrome: DiscountsStepChromeCopy;
}
