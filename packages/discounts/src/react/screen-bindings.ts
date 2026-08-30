"use client";

import { useServerDataViews } from "@12-apps/app-shell/react";

import type { DiscountsPagination, WireTargetGroup } from "./api";
import type { MenuBinding, DiscountsScreenProps } from "./discounts-screen";
import { discountsQueryToParams } from "./table-config";

/**
 * The two bindings {@link DiscountsScreen} hands down — pagination and the row
 * menu — lifted out of it.
 *
 * Neither is a second concern; they live here because that component is at both
 * the size and the complexity ceilings, and these are the parts of it that are
 * pure plumbing rather than layout.
 */

/**
 * The grid's server-side pagination binding, with the defaults a page that has
 * not loaded yet needs.
 *
 * Its own hook so the three `??` fallbacks are not branches inside
 * {@link DiscountsScreen}, which sits at the complexity ceiling.
 */
export function usePagedServer(
  pagination: DiscountsPagination | undefined,
): ReturnType<typeof useServerDataViews> {
  return useServerDataViews({
    totalCount: pagination?.total ?? 0,
    page: pagination?.page ?? 1,
    pageSize: pagination?.pageSize ?? 20,
    toParams: discountsQueryToParams,
  });
}

/**
 * The binding every row menu, tile and card receives — built once so an edit
 * opened from any of the three offers the same pickers.
 *
 * A helper rather than an inline literal: the optional `timezoneLabel` is a
 * conditional spread, and {@link DiscountsScreen} is at the complexity ceiling.
 */
export function toMenuBinding(
  props: DiscountsScreenProps,
  groups: readonly WireTargetGroup[] | undefined,
): MenuBinding {
  const { api, copy, formatters, currencyField, onError, timezoneLabel } = props;
  return {
    api,
    copy,
    formatters,
    currencyField,
    groups,
    onError,
    ...(timezoneLabel ? { timezoneLabel } : {}),
  };
}
