import {
  EN_US_AUTOCOMPLETE_COPY,
  EN_US_CATEGORY_SELECT_COPY,
  EN_US_CONFIRM_ACTION_COPY,
  EN_US_DATA_VIEWS_COPY,
} from "@12-apps/ui/en-US";

import type { DiscountsWebCopy } from "./copy";

/**
 * The en-US pack for the discounts admin screens.
 *
 * A NAMED PACK a host passes by hand, never a default. The four composed packs
 * come from `@12-apps/ui`'s own English side rather than being restated here,
 * exactly as the pt-BR pack composes the Portuguese ones.
 *
 * The `{token}` substitutions are the package's own and are NOT translated —
 * `fill()` replaces them, so a renamed token is a sentence that renders its own
 * placeholder. Their ORDER is free, which is what naming them buys.
 *
 * The KEYS of `labels.*` are the engine's wire values (`PERCENTAGE`, `ORDER`,
 * `RUNNING`, …). Only the words beside them are translated.
 */
export const EN_US_DISCOUNTS_WEB_COPY: DiscountsWebCopy = {
  screen: {
    title: "Discounts",
    aboutTitle: "About discounts",
    aboutBody:
      "Create automatic promotions or coupon codes — for the whole order, one category, named products, or a bundle.",
    create: "New discount",
    empty: "No discounts yet.",
    // A FILENAME, not a sentence: it is what the export lands on disk as.
    exportFileName: "discounts",
    loading: "Loading discounts…",
    loadFailed: "Could not load the discounts",
    retry: "Try again",
    columns: {
      name: "Name",
      value: "Discount",
      type: "Type",
      scope: "Applies to",
      trigger: "Trigger",
      window: "Validity",
      code: "Code",
      usageCount: "Uses",
      active: "Active",
    },
    yes: "Yes",
    no: "No",
  },
  labels: {
    kind: {
      PERCENTAGE: "Percentage",
      FIXED_AMOUNT: "Fixed amount",
      COMBO: "Bundle",
      FREE_UNITS: "Free items",
      BUNDLE_PRICE: "Bundle price",
    },
    type: {
      PERCENTAGE: "Percentage",
      FIXED_AMOUNT: "Fixed amount",
      BUNDLE_PRICE: "Bundle price",
      FREE_UNITS: "Free items",
    },
    scope: {
      ORDER: "Order",
      CATEGORY: "Category",
      ITEM: "Item",
      COMBO: "Bundle",
    },
    trigger: {
      AUTOMATIC: "Automatic",
      CODE: "Code",
    },
    window: {
      RUNNING: "Running",
      SCHEDULED: "Scheduled",
      ENDED: "Ended",
    },
  },
  // All four shapes get their own phrasing, for the reason the window helper
  // records: a dash on one side would leave the operator guessing whether the
  // promotion has no start or no end, and those mean very different things
  // when it is not running yet.
  window: {
    always: "No end date",
    from: "From {date}",
    until: "Until {date}",
    between: "{from} to {to}",
  },
  schedule: {
    sectionTitle: "When it applies",
    periodTitle: "Period",
    periodHint: "Leave blank to run with no end date.",
    repetitionTitle: "Repeats",
    always: "Always, within the period",
    specific: "On specific days and hours",
    builderTitle: "Days and hours",
    addWindow: "Add another time",
    removeWindow: "Remove time",
    fromLabel: "From",
    toLabel: "to",
    presetEveryDay: "Every day",
    presetWeekdays: "Mon to Fri",
    presetWeekend: "Weekend",
    dayShort: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    dayLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    dayEvery: [
      "Every Monday",
      "Every Tuesday",
      "Every Wednesday",
      "Every Thursday",
      "Every Friday",
      "Every Saturday",
      "Every Sunday",
    ],
    listSeparator: ", ",
    listLast: " and ",
    allDays: "Every day",
    weekdays: "Monday to Friday",
    weekend: "Saturday and Sunday",
    summary: "{days}, from {from} to {to}.",
    summaryOvernight: "{days}, from {from} to {to} the next day.",
    timezoneNote: "{timezone} time.",
    guaranteeNote: "The price is held from the moment the item went into the cart.",
    orderScopeNote:
      "Applies to orders placed within these hours. Unlike the other scopes, which follow the moment each item went into the cart.",
    windowWithSchedule: "{window} · {schedule}",
    moreWindows: "+{count}",
    activeNow: "Running now",
    daysRequired: "Pick at least one day.",
    timesRequired: "Enter a start and end time that differ.",
    windowsRequired: "Add at least one time.",
  },
  form: {
    createTitle: "New discount",
    editTitle: "Edit discount",
    submitCreate: "Create discount",
    submitEdit: "Save changes",
    name: "Promotion name",
    type: "Type",
    kind: "Promotion type",
    comboReward: "Bundle discount",
    comboRewardHint: "The bundle sells for the price of its items minus this discount.",
    percentOff: "Discount (%)",
    percentPlaceholder: "10",
    amountOff: "Discount amount",
    bundlePrice: "Bundle price",
    freeUnits: "Free items",
    freeUnitsHint:
      'How many units of the bundle are free. In a group of 3, making 1 free is the classic "buy 3, pay for 2".',
    trigger: "Trigger",
    code: "Coupon code",
    // A sample CODE, not a word: it shows the shape of one a shopper types.
    codePlaceholder: "WELCOME10",
    scope: "Applies to",
    startsAt: "Starts",
    endsAt: "Ends",
    minSubtotal: "Minimum order",
    usageLimit: "Usage limit",
    perBuyerLimit: "Limit per customer",
    maxComboApplications: "Bundles per order",
    maxComboApplicationsHint: "Leave blank to apply as many times as the cart allows.",
    maxFreeUnitsApplications: "Times per order",
    active: "Active",
    activeHint: "Switch off to pause the promotion without deleting it.",
    stackable: "Stackable",
    stackableHint:
      "When off, this promotion is exclusive: if it wins, no other one is applied.",
    reviewFields: "Check the highlighted fields.",
    saveFailed: "Could not save the discount",
    nameRequired: "Give the promotion a name.",
    invalidPercent: "Enter a percentage greater than 0 and at most 100.",
    invalidAmount: "Enter a discount amount greater than zero.",
    invalidBundlePrice: "Enter the bundle price, greater than zero.",
    invalidFreeUnits: "Enter how many items are free, from 1 upwards.",
    freeUnitsExceedCombo:
      "The bundle has {units} items; make at most {max} free for it to still be a promotion.",
    freeUnitsTargetRequired: "Pick at least one product for the promotion.",
    codeRequired: "Enter the coupon code the customer will type.",
    categoryTargetRequired: "Select at least one category for this discount.",
    itemTargetRequired: "Select at least one product for this discount.",
    comboSlotsRequired: "Build the bundle: add at least one group of items.",
    comboSlotTargetRequired: "Choose what can go in each group of the bundle.",
    invalidComboQuantity: "Enter how many units each group takes, from 1 upwards.",
    invalidMaxComboApplications: "Enter how many bundles fit in one order, from 1 upwards.",
    endsBeforeStarts: "The end date must be after the start date.",
  },
  combo: {
    title: "Build the bundle",
    hint: "Each group is one part of the bundle: how many units it takes, and what can go in it.",
    addSlot: "Add group",
    removeSlot: "Remove group {position}",
    slot: "Group {position}",
    quantity: "Quantity",
    // `{collection}` is the HOST's word for what is being picked, so the
    // sentence is built around it rather than naming a noun of its own.
    pick: "{collection} in this group",
    empty: "No groups yet. Add the first one to build the bundle.",
    summary: "The bundle takes {units} items across {groups} groups.",
    freeUnitsTitle: "Buy more, pay less",
    freeUnitsHint:
      'Choose the products, how many the customer takes and how many are free — the classic "buy 3, pay for 2".',
    buyQuantity: "The customer takes",
    freeUnitsPick: "{collection} in the promotion",
    freeUnitsSummary: "Take {units}, pay for {paid}.",
  },
  targets: {
    pick: "Discounted {collection}",
    search: "Search {collection}…",
    required: "Select at least one option.",
  },
  actions: {
    menu: "Actions",
    edit: "Edit",
    delete: "Delete",
    deleteTitle: "Delete this discount?",
    deleteDescription: "It stops applying in the storefront and cannot be restored.",
    deleteManyTitle: "Delete {count} discounts?",
    deleteManyDescription: "They stop applying in the storefront and cannot be restored.",
    deleteFailed: "Could not delete the discount.",
    actionFailed: "Could not complete the action",
    actionFailedDismiss: "Dismiss",
  },
  card: {
    paused: "Paused",
    ruleHeading: "Rule",
    targetsHeading: "Targets",
    wholeOrder: "the whole order",
    oneTarget: "1 target",
    manyTargets: "{count} targets",
    withCode: "code {code}",
    noTargets: "No targets",
    usage: "Uses",
    minSubtotal: "Minimum order",
    perBuyerLimit: "Limit per customer",
    unlimited: "No limit",
  },
  confirmAction: EN_US_CONFIRM_ACTION_COPY,
  dataViews: EN_US_DATA_VIEWS_COPY,
  categorySelect: EN_US_CATEGORY_SELECT_COPY,
  autocomplete: EN_US_AUTOCOMPLETE_COPY,
};
