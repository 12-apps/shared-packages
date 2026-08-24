import type { JSX } from 'react';

import { renderWiringReport } from '@12-apps/wiring/consumer';

import { webWiringReport } from '../wiring-web';

/**
 * THE REPORT, rendered — the browser half of the question the consumer exists
 * to make askable.
 *
 * `assemble()` is the refusal: it throws while any declared capability of any
 * adopted package is unanswered, and the backend harness asserts its report in
 * a unit suite. The web half had nowhere to make the same claim, because a
 * frontend host has no test that runs its module graph outside a browser — so
 * this page IS that test's fixture: rendering it runs `assemble()` over every
 * surface the app adopted, and a spec reads the result.
 *
 * That makes an unanswered capability a RED PAGE rather than a silence. Before
 * this, a package could ship a new web capability, no host could bind it, and
 * every screen would keep rendering exactly as before.
 *
 * The registry imports every page module, so by the time this renders each of
 * them has adopted into the shared host — see `wiring-web.ts` for why the
 * report is a function rather than a constant.
 */
export function WiringReportPage(): JSX.Element {
  const report = webWiringReport();

  return (
    <div data-testid="wiring-report">
      <h1>Wiring report</h1>
      <p data-testid="wiring-host">{`${report.host} (${report.kind})`}</p>
      <ul>
        {report.packages.map((entry) => (
          <li key={entry.packageName} data-testid={`wiring-package-${entry.packageName}`}>
            <strong>{entry.packageName}</strong>
            <ul>
              {entry.capabilities.map((capability) => (
                <li
                  key={capability.kind}
                  data-testid={`wiring-${entry.packageName}-${capability.kind}`}
                  data-status={capability.status}
                >
                  {`${capability.kind}: ${capability.status} — ${capability.detail}`}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {/* The rendered form the packages' own docs quote, so a human reading the
          page sees what a host's boot log would print. */}
      <pre data-testid="wiring-report-text">{renderWiringReport(report)}</pre>
    </div>
  );
}
