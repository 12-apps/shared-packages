/**
 * Page furniture shared by the checkout harness pages (FUT-743).
 *
 * A page that needs several stores — three buyer-field declarations, three
 * failure shapes — renders them as CASES rather than as separate slugs: the
 * registry's contract is one slug per page, and a spec addresses the page by
 * slug and then names the case. Each case is its own mount, keyed so switching
 * to it builds a fresh factory and a fresh store rather than resuming the last
 * one's state.
 */
import { useState, type JSX, type ReactNode } from 'react';

/** A titled region with a stable test id and a one-line statement of intent. */
export function Panel({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      data-testid={`panel-${id}`}
      style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24 }}
    >
      <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>{title}</h2>
      {children}
    </section>
  );
}

/** One selectable case on a multi-store page. */
export interface HarnessCase {
  id: string;
  label: string;
  render(): ReactNode;
}

/**
 * A case switcher. The chosen case's subtree is KEYED by its id, so selecting
 * another one tears the previous mount down — a page that reused the mount
 * would carry the first store's raised payable into the second store's
 * assertions.
 */
export function CaseTabs({ cases }: { cases: readonly HarnessCase[] }): JSX.Element {
  const [active, setActive] = useState(cases[0]?.id ?? '');
  const current = cases.find((entry) => entry.id === active) ?? cases[0];
  return (
    <div>
      <div data-testid="harness-cases" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {cases.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`harness-case-${entry.id}`}
            aria-pressed={entry.id === current?.id}
            onClick={() => setActive(entry.id)}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #999',
              fontWeight: entry.id === current?.id ? 700 : 400,
              cursor: 'pointer',
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div data-testid="harness-case-body" data-case={current?.id ?? 'none'}>
        {current ? <div key={current.id}>{current.render()}</div> : null}
      </div>
    </div>
  );
}

/** The one-paragraph statement of what a page proves, above the flow. */
export function PageIntro({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <header style={{ marginBottom: 20 }}>
      <h1 style={{ fontSize: 18, margin: '0 0 6px' }}>{title}</h1>
      <p style={{ margin: 0, color: '#555', fontSize: 13, maxWidth: 720 }}>{children}</p>
    </header>
  );
}
