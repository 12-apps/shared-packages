import type { JSX } from 'react';
import { HashRouter } from 'react-router-dom';

import { discountsManifest } from '@12-apps/discounts/manifest';
import { discountsWebManifest } from '@12-apps/discounts/manifest/web';
import { PT_BR_DISCOUNTS_WEB_COPY } from '@12-apps/discounts/react';
import { Fields } from '@12-apps/ui/form/total-form';

import { webLoggerFor, webWiringHost } from '../wiring-web';

/**
 * `@12-apps/discounts` — the promotions admin, adopted through the wiring
 * consumer's WEB half.
 *
 * This package was the sharpest hole in the harness and the least visible kind:
 * its SERVER half has been mounted and tested here for a while
 * (`/api/admin/harness/discounts`, eight backend cases over the packed
 * tarball), and its web half had **zero** presence in this app. So the demo
 * host had the API with no screen — and every one of these components,
 * fourteen form inputs and two card layouts included, shipped release after
 * release with no consumer anywhere.
 *
 * Nothing was red, and nothing could be: `assemble()` reports on the packages a
 * host ADOPTED, so a web manifest nobody binds is not an unanswered capability
 * — it is a package the report never hears about. That is the failure this page
 * closes, and `tests/manifest-web-adoption.spec.ts` is what stops the next one.
 *
 * ## What the host actually supplies
 *
 * Less than it looks. The grid with its filters and export, the create/edit
 * form, the target pickers, the four confirmations and every wire call between
 * them are the package's. What is genuinely ours:
 *
 * - **where the API is mounted** — the backend hangs the discounts router at
 *   `/api/admin/:tenantSlug`, and `harness` is this app's tenant;
 * - **the words** — required, no defaults. The package's own pt-BR pack is
 *   passed rather than retyped, which is what a pt-BR host does;
 * - **the notation** — `locale` decides parsing as much as rendering, because
 *   the form reads back what an operator typed in their own notation;
 * - **the currency** — separate from the locale on purpose, and the package is
 *   right to insist: a currency inferred from a language is a wrong PRICE;
 * - **where a failure goes** beyond the operator's own screen;
 * - **the money input**, because currency entry is a host decision with no
 *   neutral answer to ship.
 */

/** The tenant this harness is. Matches `DISCOUNTS_TENANT_ID` in the backend. */
const API_BASE = '/api/admin/harness';

/**
 * A plain text field, which is exactly what the package says a host with
 * nothing special passes.
 *
 * The alternative — a masked, cents-aware input — is a real host's decision and
 * would make this page a demonstration of OUR input rather than of the
 * package's form. `@12-apps/ui`'s `Fields.TextField` is the same component the
 * package's own contract test reaches for.
 */
const CurrencyField = ({ name, label }: { name: string; label: string }): JSX.Element => (
  <Fields.TextField name={name} label={label} />
);

/**
 * Where a discounts failure goes.
 *
 * Wired to the host's own logger port — the SAME one `wiring-web.ts` answers
 * the observability capability with, rather than a second console shim beside
 * it. The package requires this and argues why — the screens already SHOW an operator what went
 * wrong, which is not the same as anybody knowing, and a no-op default makes
 * "nothing is broken" and "nothing is watching" look identical. `context` is a
 * stable dotted token, so it is passed through as the namespace a reporter
 * groups on.
 */
const log = webLoggerFor('@12-apps/discounts');

const { surface } = webWiringHost.adoptWeb({
  manifest: discountsManifest,
  web: discountsWebManifest,
  bindings: {
    surface: {
      config: {
        apiBase: API_BASE,
        copy: PT_BR_DISCOUNTS_WEB_COPY,
        locale: 'pt-BR',
        currency: 'BRL',
        onError: (error: unknown, context: string) => log.error(context, error),
        currencyField: CurrencyField,
      },
    },
  },
});

const Screen = (surface as { Screen: () => JSX.Element }).Screen;

/**
 * The Router the screen's FILTERS need, and why it is a real one.
 *
 * `DiscountsScreen` keeps its grid state in `useSearchParams` — `react-router-dom`
 * is a declared peer of the package, not an incidental import — so a filtered
 * view is a URL an operator can bookmark and send to a colleague. A
 * `MemoryRouter` would satisfy the context and silently throw that away: every
 * screen would render, every filter would work, and the address bar would never
 * move. That is the shape of defect this harness exists to make visible, so the
 * host wires the thing a real host wires.
 *
 * `basename` is this page's own slug — the segment the shell reads to decide
 * which page is showing — so the surface writes `#/discounts?kind=…` and the
 * shell still finds `discounts` at the front of it.
 */
export function DiscountsPage(): JSX.Element {
  return (
    <div data-testid="page-discounts">
      <HashRouter basename="/discounts">
        <Screen />
      </HashRouter>
    </div>
  );
}
