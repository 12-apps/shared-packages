import type { JSX } from "react";

import { Fields } from "@12-apps/ui/form/total-form";

import type { DiscountsPage, DiscountWireRecord, WireTargetGroup } from "../api";
import type { CurrencyFieldComponent } from "../discount-form-fields";
import type { DiscountsResult, DiscountsTransport } from "../transport";

/**
 * The world every discounts story is set in.
 *
 * A fake API CLIENT rather than a mocked `fetch`: the transport is the seam, so
 * substituting it is the sanctioned way to drive these screens — and it is what
 * lets a story show a REFUSED write and a failed read, which a happy-path stub
 * never can.
 */

/** A store whose promotions cover every branch these screens render. */
export const STORY_DISCOUNTS: DiscountWireRecord[] = [
  {
    id: "d-percent",
    name: "10% de boas-vindas",
    type: "PERCENTAGE",
    percentOffBp: 1_000,
    amountOffCents: null,
    scope: "ORDER",
    trigger: "CODE",
    code: "BEMVINDO10",
    startsAt: null,
    endsAt: null,
    minSubtotalCents: 3_000,
    usageLimit: 500,
    perBuyerLimit: 1,
    usageCount: 87,
    stackable: true,
    active: true,
    categoryIds: [],
    menuItemIds: [],
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "d-category",
    name: "Bebidas em agosto",
    type: "FIXED_AMOUNT",
    percentOffBp: null,
    amountOffCents: 300,
    scope: "CATEGORY",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: "2026-09-01T00:00:00.000Z",
    minSubtotalCents: null,
    usageLimit: null,
    perBuyerLimit: null,
    usageCount: 214,
    stackable: true,
    active: true,
    categoryIds: ["c-drinks"],
    menuItemIds: [],
    createdAt: "2026-07-28T00:00:00.000Z",
  },
  {
    id: "d-combo",
    name: "Combo pipoca",
    type: "BUNDLE_PRICE",
    percentOffBp: null,
    amountOffCents: null,
    bundlePriceCents: 2_500,
    scope: "COMBO",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: "2026-12-01T00:00:00.000Z",
    endsAt: null,
    minSubtotalCents: null,
    usageLimit: null,
    perBuyerLimit: null,
    usageCount: 0,
    stackable: false,
    active: true,
    categoryIds: [],
    menuItemIds: [],
    comboRequirements: [
      { menuItemIds: ["m-popcorn"], categoryIds: [], quantity: 1 },
      { menuItemIds: [], categoryIds: ["c-drinks"], quantity: 2 },
    ],
    createdAt: "2026-08-10T00:00:00.000Z",
  },
  {
    id: "d-paused",
    name: "Leve 3 pague 2",
    type: "FREE_UNITS",
    percentOffBp: null,
    amountOffCents: null,
    freeUnits: 1,
    scope: "COMBO",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: null,
    endsAt: "2026-08-15T00:00:00.000Z",
    minSubtotalCents: null,
    usageLimit: 100,
    perBuyerLimit: null,
    usageCount: 100,
    stackable: true,
    active: false,
    categoryIds: [],
    menuItemIds: ["m-burger"],
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "d-item",
    name: "Hambúrguer da casa",
    type: "PERCENTAGE",
    percentOffBp: 1_550,
    amountOffCents: null,
    scope: "ITEM",
    trigger: "AUTOMATIC",
    code: null,
    startsAt: null,
    endsAt: null,
    minSubtotalCents: null,
    usageLimit: null,
    perBuyerLimit: 2,
    usageCount: 9,
    stackable: true,
    active: true,
    categoryIds: [],
    menuItemIds: ["m-burger", "m-fries"],
    createdAt: "2026-08-12T00:00:00.000Z",
  },
];

/** The two collections a host of this shape registers. */
export const STORY_GROUPS: WireTargetGroup[] = [
  {
    targetType: "CATEGORY",
    slug: "categories",
    label: "Categorias",
    nests: true,
    targets: [
      { id: "c-drinks", name: "Bebidas", parentId: null },
      { id: "c-sodas", name: "Refrigerantes", parentId: "c-drinks" },
      { id: "c-mains", name: "Pratos", parentId: null },
    ],
  },
  {
    targetType: "ITEM",
    slug: "products",
    label: "Produtos",
    nests: false,
    targets: [
      { id: "m-burger", name: "Hambúrguer da casa" },
      { id: "m-fries", name: "Batata frita" },
      { id: "m-popcorn", name: "Pipoca grande" },
    ],
  },
];

function pageOf(rows: DiscountWireRecord[]): DiscountsPage {
  return {
    data: rows,
    pagination: {
      page: 1,
      pageSize: 20,
      total: rows.length,
      pageCount: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

export interface StoryWorldOptions {
  rows?: DiscountWireRecord[];
  groups?: WireTargetGroup[];
  /** Make every write fail with this, to show the refusal path. */
  refuseWith?: { error: string; fieldErrors?: Record<string, string> };
  /** Make the page read fail, to show the error state. */
  failList?: string;
  /** Never settle, to show the loading state. */
  neverSettle?: boolean;
}

/**
 * A transport over the fixtures above.
 *
 * A TRANSPORT rather than a stubbed client, because that is the seam a host
 * substitutes — so a story exercises the real `createDiscountsApiClient`, the
 * real path building and the real envelope unwrapping, and only the bytes are
 * pretend. A stubbed client would leave all of that untested and would keep
 * passing after a path changed.
 */
export function storyTransport(options: StoryWorldOptions = {}): DiscountsTransport {
  const rows = options.rows ?? STORY_DISCOUNTS;
  const groups = options.groups ?? STORY_GROUPS;
  const pending = <T,>(): Promise<T> => new Promise<T>(() => {});
  return {
    get: <T,>(path: string): Promise<T> => {
      if (options.neverSettle) return pending<T>();
      if (path.includes("/discounts/targets")) {
        return Promise.resolve({ data: groups } as T);
      }
      if (options.failList) return Promise.reject(new Error(options.failList));
      return Promise.resolve(pageOf(rows) as T);
    },
    send: <T,>(): Promise<DiscountsResult<T>> => {
      if (!options.refuseWith) return Promise.resolve({ ok: true, data: null as T });
      const { error, fieldErrors } = options.refuseWith;
      return Promise.resolve({
        ok: false,
        error,
        status: 422,
        ...(fieldErrors ? { fieldErrors } : {}),
      });
    },
  };
}

/**
 * The money input a host would supply.
 *
 * A plain text field, on purpose: the surface takes this component precisely
 * because currency entry is a host decision, and a story shipping a clever
 * masked one would be showing a choice the package does not make.
 */
export const StoryCurrencyField: CurrencyFieldComponent = ({ name, label }): JSX.Element => (
  <Fields.TextField name={name} label={label} placeholder="0,00" />
);

/** What a story does with a reported failure: show that the seam was reached. */
export function storyOnError(error: unknown, context: string): void {
  // A console line is the right output here, and only here: it demonstrates
  // that the host's reporter WOULD have been called, without the story taking a
  // reporter dependency of its own.
  console.warn(`[discounts:onError] ${context}`, error);
}
