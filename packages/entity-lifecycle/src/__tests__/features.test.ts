import { describe, expect, it } from 'vitest';

import { resolveFeature } from '../features';

const config = {
  features: { versioning: true, approvals: true },
  featureDefaults: { approvals: false },
};

describe('resolveFeature — code && plan && tenant layers', () => {
  it('is off when the collection did not opt in (code layer)', () => {
    expect(resolveFeature('drafts', config, { drafts: true }, { drafts: true })).toEqual({
      enabled: false,
      reason: 'not-supported',
    });
  });

  it('is off when the tenant is not entitled (plan layer)', () => {
    expect(resolveFeature('versioning', config, {}, {})).toEqual({
      enabled: false,
      reason: 'not-entitled',
    });
  });

  it('entitled + untouched toggle falls back to the default', () => {
    // versioning defaults on…
    expect(resolveFeature('versioning', config, { versioning: true }, {})).toEqual({
      enabled: true,
      reason: 'enabled',
    });
    // …approvals declared default-off (opt-in via the config panel).
    expect(resolveFeature('approvals', config, { approvals: true }, {})).toEqual({
      enabled: false,
      reason: 'disabled-by-tenant',
    });
  });

  it('an entitled tenant may switch a feature off — and back on', () => {
    expect(
      resolveFeature('versioning', config, { versioning: true }, { versioning: false }),
    ).toEqual({ enabled: false, reason: 'disabled-by-tenant' });
    expect(
      resolveFeature('approvals', config, { approvals: true }, { approvals: true }),
    ).toEqual({ enabled: true, reason: 'enabled' });
  });
});
