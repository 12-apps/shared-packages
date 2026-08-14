// @vitest-environment jsdom
// `fireEvent` rather than `@testing-library/user-event`: user-event is not a
// dependency of this package and does not resolve from here, so importing it
// fails the whole suite at collection time. fireEvent ships with
// @testing-library/react and is act()-wrapped, which is what these tests need.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EntitlementSnapshot } from '../../core/types';
import {
  Entitled,
  EntitlementsProvider,
  Locked,
  useEntitlement,
  useQuota,
  useUpsell,
} from '../context';

type F = 'forecast.history' | 'alerts.webhook' | 'crew.seats';

const SNAPSHOT: EntitlementSnapshot<F> = {
  tenantId: 't1',
  status: 'active',
  planKey: 'plus',
  features: {
    'alerts.webhook': {
      feature: 'alerts.webhook',
      enabled: true,
      reason: 'enabled',
      policy: 'disable',
      limit: null,
      requiredPlan: null,
    },
    'forecast.history': {
      feature: 'forecast.history',
      enabled: false,
      reason: 'not-entitled',
      policy: 'hide',
      limit: null,
      requiredPlan: 'network',
    },
    'crew.seats': {
      feature: 'crew.seats',
      enabled: true,
      reason: 'enabled',
      policy: 'readonly',
      limit: 5,
      requiredPlan: null,
    },
  },
};

function wrap(ui: React.ReactNode, onUpsell?: (r: { feature: F }) => void) {
  return render(
    <EntitlementsProvider<F>
      snapshot={SNAPSHOT}
      onUpsell={onUpsell as never}
    >
      {ui}
    </EntitlementsProvider>,
  );
}

describe('<Entitled>', () => {
  it('renders children when entitled', () => {
    wrap(<Entitled feature="alerts.webhook">yes</Entitled>);
    expect(screen.getByText('yes')).toBeDefined();
  });

  it('renders the fallback when not', () => {
    wrap(
      <Entitled feature="forecast.history" fallback={<span>locked</span>}>
        yes
      </Entitled>,
    );
    expect(screen.getByText('locked')).toBeDefined();
  });
});

describe('<Locked>', () => {
  it('renders an upsell for a plan denial and reports the target plan', () => {
    wrap(
      <Locked feature="forecast.history">
        {({ requiredPlan }) => <span>upgrade to {requiredPlan}</span>}
      </Locked>,
    );
    expect(screen.getByText(/upgrade to network/)).toBeDefined();
  });

  it('renders nothing when the feature is usable', () => {
    const { container } = wrap(
      <Locked feature="alerts.webhook">{() => <span>upsell</span>}</Locked>,
    );
    expect(container.textContent).toBe('');
  });

  it('renders nothing for a self-disabled feature — that is not a sale', () => {
    const snapshot: EntitlementSnapshot<F> = {
      ...SNAPSHOT,
      features: {
        ...SNAPSHOT.features,
        'alerts.webhook': { ...SNAPSHOT.features['alerts.webhook'], enabled: false, reason: 'disabled-by-tenant' },
      },
    };
    const { container } = render(
      <EntitlementsProvider<F> snapshot={snapshot}>
        <Locked feature="alerts.webhook">{() => <span>upsell</span>}</Locked>
      </EntitlementsProvider>,
    );
    expect(container.textContent).toBe('');
  });

  it('hands the host an upsell callback rather than owning the modal', () => {
    const onUpsell = vi.fn();
    wrap(
      <Locked feature="forecast.history">
        {({ upsell }) => (
          <button type="button" onClick={upsell}>
            unlock
          </button>
        )}
      </Locked>,
      onUpsell,
    );
    // A bare `element.click()` dispatches outside act(), so React may still owe
    // work when the assertion runs. fireEvent wraps the dispatch in act(), which
    // flushes the handler and any resulting render synchronously — the mock is
    // guaranteed settled on the next line, with no polling window.
    fireEvent.click(screen.getByText('unlock'));
    expect(onUpsell).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'forecast.history', requiredPlan: 'network' }),
    );
  });
});

describe('hooks', () => {
  function Probe({ feature, used }: { feature: F; used: number }) {
    const decision = useEntitlement<F>(feature);
    const quota = useQuota<F>(feature, used);
    return (
      <span>
        {String(decision.enabled)}|{quota.remaining}|{String(quota.exceeded)}
      </span>
    );
  }

  it('computes quota remaining from caller-supplied usage', () => {
    wrap(<Probe feature="crew.seats" used={3} />);
    expect(screen.getByText('true|2|false')).toBeDefined();
  });

  it('reports an exceeded quota', () => {
    wrap(<Probe feature="crew.seats" used={5} />);
    expect(screen.getByText('true|0|true')).toBeDefined();
  });

  it('degrades an unknown feature to not-supported rather than crashing', () => {
    function Unknown() {
      const decision = useEntitlement('ghost');
      return <span>{decision.reason}</span>;
    }
    wrap(<Unknown />);
    expect(screen.getByText('not-supported')).toBeDefined();
  });

  it('throws a useful error outside a provider', () => {
    function Bare() {
      useEntitlement('alerts.webhook');
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/within an <EntitlementsProvider>/);
  });

  it('no-ops the upsell callback when the host wired none', () => {
    function Trigger() {
      const upsell = useUpsell<F>();
      return (
        <button type="button" onClick={() => upsell('forecast.history')}>
          go
        </button>
      );
    }
    render(
      <EntitlementsProvider<F> snapshot={SNAPSHOT}>
        <Trigger />
      </EntitlementsProvider>,
    );
    // fireEvent dispatches synchronously inside act(), so a throw from the
    // missing-handler path propagates straight out of this callback and fails
    // the assertion — there is no promise for the failure to escape into. That
    // keeps the original meaning: a missing onUpsell is a silent no-op, not an
    // exception in the host's render tree.
    expect(() => fireEvent.click(screen.getByText('go'))).not.toThrow();
  });
});
