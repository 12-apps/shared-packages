"use client";

import { useMemo, type ComponentType, type JSX } from "react";

import { createDiscountsApiClient, type DiscountsApiClient } from "./api";
import { missingWebCopy, type DiscountsWebCopy } from "./copy";
import { DiscountForm, type DiscountFormProps } from "./discount-form";
import type { CurrencyFieldComponent } from "./discount-form-fields";
import { DiscountsScreen, type DiscountsScreenProps } from "./discounts-screen";
import { createFormatters, type DiscountsFormatters } from "./format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "./pt-BR";
import { httpDiscountsTransport, type DiscountsTransport } from "./transport";

/**
 * The one thing this package exposes to a FRONTEND host.
 *
 * Everything the promotions admin IS — the server-driven grid with its filters
 * and its export, the create/edit form and its fourteen inputs, the target
 * pickers, both card layouts, the four confirmations and every wire call
 * between them — lives inside this package now. The host names where the API is
 * mounted, supplies every sentence, says which locale its operators read, and
 * that is the whole wiring.
 *
 * ## Build it ONCE, at module scope
 *
 * The members are component TYPES. Rebuilding the surface per render gives
 * React new types every time, which unmounts and remounts the entire tree below
 * — a form loses what the operator typed on every keystroke that reaches the
 * page above it. Every `createWeb*` in this org carries the same warning
 * because it is the same hazard, and it is silent: the screen works, it just
 * cannot be typed into.
 */

export interface DiscountsWebConfig {
  /** The admin mount the routes live under, e.g. `/api/admin/my-store`. */
  apiBase: string;
  /**
   * Every sentence the screens render — REQUIRED, the host's words. A pt-BR
   * host passes `PT_BR_DISCOUNTS_WEB_COPY`.
   */
  copy: DiscountsWebCopy;
  /**
   * How money, percentages and dates are written — and READ BACK. A form takes
   * what the operator typed in their own notation, so this decides parsing as
   * much as rendering.
   */
  locale: string;
  /** ISO 4217, e.g. `BRL`. */
  currency: string;
  /**
   * The STORE's timezone, as a name an operator recognises ("São Paulo") —
   * shown under the schedule's clocks (FUT-996).
   *
   * A label rather than an IANA id, because it is read by a person and
   * "America/Sao_Paulo" is not how anyone says it. The engine never sees this:
   * resolving an instant into the store's wall clock is the SERVER's job, and
   * this string exists so a merchant typing 16:00 knows whose 16:00 it is —
   * which is not a rhetorical worry for a store admin sitting in another one.
   *
   * Optional: a host that has not adopted schedules yet shows the builder
   * without the line rather than a wrong one.
   */
  timezoneLabel?: string;
  /**
   * The store's IANA timezone (`America/Sao_Paulo`) — what the grid's
   * "ativa agora" dot is computed against (FUT-996).
   *
   * Separate from {@link timezoneLabel} because they do different jobs: this
   * one is read by `Intl`, that one is read by a person. Deriving the label
   * from this would print "Sao_Paulo" at a merchant.
   *
   * Omitted ⇒ no dot. A rule's SCHEDULE still shows in the vigência cell; only
   * the live "is it running this minute" answer is withheld, because without a
   * zone it would be the browser's answer rather than the store's — and a shop
   * whose admin is abroad would be told its happy hour is off while it is on.
   */
  timezone?: string;
  /**
   * Where a failure goes, beyond the operator's own screen — REQUIRED, and for
   * the same reason `createApiDiscounts` requires a logger.
   *
   * The screens already SHOW an operator what went wrong; that is not the same
   * as anybody knowing. A refused write, a catalog that would not load, a page
   * read that failed — each of those reaches a person only if a host routes it
   * somewhere, and a no-op default here would make "nothing is broken" and
   * "nothing is watching" look identical. A host wires this to its browser
   * error reporter.
   *
   * `context` is a stable dotted token (`discounts.create`, `discounts.list`)
   * rather than a sentence, so a reporter can group on it.
   */
  onError: (error: unknown, context: string) => void;
  /**
   * The money input. Currency entry is a host decision — masking, which side
   * the symbol sits on, whether cents are typed or implied — and there is no
   * neutral answer to ship. A host with nothing special passes a plain text
   * field.
   */
  currencyField: CurrencyFieldComponent;
  /** How the surface reaches its data. Default: same-origin fetch. */
  transport?: DiscountsTransport;
  /** The crumbs above the title. The host owns its information hierarchy. */
  breadcrumb?: readonly { label: string; href?: string }[];
}

export interface WebDiscounts {
  /** The whole promotions admin. */
  Screen: ComponentType;
  /**
   * The form on its own, for a host embedding it somewhere of its own — an
   * onboarding step, a wizard. Already bound to the same client and copy.
   */
  DiscountForm: ComponentType<
    Pick<DiscountFormProps, "editing" | "groups" | "onSaved">
  >;
  /** The bound wire client, for host glue. */
  api: DiscountsApiClient;
  /** The bound formatters, for a host rendering a discount outside these screens. */
  formatters: DiscountsFormatters;
}

/** Assert the config at construction, where the wiring is written. */
function assertConfig(config: DiscountsWebConfig): void {
  const missing = missingWebCopy(config.copy, PT_BR_DISCOUNTS_WEB_COPY);
  if (missing.length > 0) {
    throw new Error(
      `@12-apps/discounts: createWebDiscounts is missing copy for ${missing.join(", ")} — ` +
        "every sentence these screens render is host config, with no defaults.",
    );
  }
  if (typeof config.onError !== "function") {
    throw new Error(
      "@12-apps/discounts: createWebDiscounts needs an onError — a surface whose " +
        "failures reach nobody is indistinguishable from one that never fails.",
    );
  }
}

export function createWebDiscounts(config: DiscountsWebConfig): WebDiscounts {
  assertConfig(config);
  const { copy, onError, currencyField, breadcrumb, timezoneLabel, timezone } = config;
  const formatters = createFormatters(config.locale, config.currency);
  const transport = config.transport ?? httpDiscountsTransport(copy.form.saveFailed);
  const api = createDiscountsApiClient(config.apiBase, transport, formatters);

  const screenProps: DiscountsScreenProps = {
    api,
    copy,
    formatters,
    currencyField,
    onError,
    ...(breadcrumb ? { breadcrumb } : {}),
    ...(timezoneLabel ? { timezoneLabel } : {}),
    ...(timezone ? { timezone } : {}),
  };

  return {
    Screen: () => <DiscountsScreen {...screenProps} />,
    DiscountForm: (props) => (
      <DiscountForm
        api={api}
        copy={copy}
        formatters={formatters}
        currencyField={currencyField}
        onError={onError}
        {...(timezoneLabel ? { timezoneLabel } : {})}
        {...props}
      />
    ),
    api,
    formatters,
  };
}

/**
 * The same factory, memoised on config IDENTITY — the shape a host that must
 * build inside a component should reach for.
 *
 * Not a substitute for building at module scope: `useMemo` keyed on the config
 * object still rebuilds whenever that object is a fresh literal, which it is on
 * every render unless the host memoised it too. It exists for the case where
 * the mount path genuinely is dynamic (the api base carries a tenant slug from
 * the router), and it makes the dependency explicit instead of silent.
 */
export function useWebDiscounts(config: DiscountsWebConfig): WebDiscounts {
  return useMemo(() => createWebDiscounts(config), [config]);
}

/** The screen as a bare component, for a host that wires everything itself. */
export type { DiscountsScreenProps };
export function DiscountsSurface(props: DiscountsScreenProps): JSX.Element {
  return <DiscountsScreen {...props} />;
}
