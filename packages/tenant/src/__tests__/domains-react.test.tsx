// @vitest-environment jsdom
/**
 * The screen renders from the HOST's pack and widgets: an invented pack (no
 * language the package was written in) proves every word is config, and the
 * test ids a host's own tests and journeys read are the ones it always had.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PointingRecord,
  createDomainsScreen,
  type TenantDomainItem,
  type TenantDomainsComponents,
  type TenantDomainsCopy,
} from '../domains/react';
import { TenantConfigError } from '../validate';

afterEach(cleanup);

const say = (key: string) => `«${key}»`;
const PACK: TenantDomainsCopy = {
  records: {
    awaitingVerification: say('waiting'),
    verificationFailed: say('failed'),
    verified: say('verified'),
    active: say('active'),
    disabled: say('disabled'),
    dnsNotHereYet: (base) => `${base}${say('elsewhere')}`,
    removeTitle: say('removeTitle'),
    placeholder: 'shop.example.net',
    emptyTitle: say('emptyTitle'),
    emptyBody: say('emptyBody'),
    recordType: say('type'),
    recordName: say('name'),
    recordValue: say('value'),
    txtStep: say('txtStep'),
    kindApex: say('apex'),
    kindSubdomain: say('sub'),
    yourCase: say('yours'),
    apexGuide: (zone) => say(`apexGuide ${zone}`),
    subdomainGuide: (example) => say(`subGuide ${example}`),
    otherApexGuide: (zone) => say(`otherApex ${zone}`),
    otherSubdomainGuide: (example) => say(`otherSub ${example}`),
    fullNameFallback: (fqdn) => say(`full ${fqdn}`),
    pointWithRecord: (type) => say(`point ${type}`),
    pointWithRecords: say('pointMany'),
    recordLabel: (type) => say(`label ${type}`),
    notPointedWarning: say('notPointed'),
    copyValue: say('copy'),
    copiedValue: say('copied'),
    copyValueLabel: (value) => say(`copy ${value}`),
    verifyAction: say('verifyNow'),
    removeAction: say('removeNow'),
  },
  pair: {
    pairAnnouncement: (root, www) => ({ before: say('both'), and: ' + ', after: `${root}/${www}` }),
    pairName: (root) => say(`pair ${root}`),
    principalQuestion: say('principal?'),
    principalRootPhone: say('rootShort'),
    principalWwwPhone: say('wwwShort'),
    principalChangeActive: say('atOnce'),
    txtStepPair: say('txtPair'),
    txtStepPairPhone: say('txtPairShort'),
    pointBothNames: say('pointBoth'),
    replaceOldRecords: say('replaceOld'),
    replaceOldRecordsPhone: say('replaceOldShort'),
    answersAt: (principal) => ({ before: say('answersAt'), after: principal }),
    redirectsFrom: () => ({ before: say('from'), after: '' }),
    otherNamePhone: (principal) => say(`other ${principal}`),
    removedTitle: (count) => say(`removed ${count}`),
    removedLine: (date, by) => say(`removedOn ${date} ${by ?? '-'}`),
    restore: say('restoreNow'),
    locale: 'en-GB',
    removeFromList: say('pairRemoveList'),
    removeConsequence: say('pairRemoveConsequence'),
  },
  closeAlert: say('close'),
};

const components: TenantDomainsComponents = {
  ConfirmButton: ({ children, confirm, dataTestId, onClick, disabled }) => (
    <button type="button" data-testid={dataTestId} data-confirm={confirm.description} disabled={disabled} onClick={() => void onClick()}>
      {children}
    </button>
  ),
  Segmented: ({ dataTestId, options, onPick }) => (
    <div data-testid={dataTestId}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onPick(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
};

const screenOf = createDomainsScreen({ copy: { locales: { 'x-test': PACK }, defaultLocale: 'x-test' }, components });

function item(extra: Partial<TenantDomainItem> = {}): TenantDomainItem {
  return {
    id: 'd1',
    hostname: 'example.net',
    wwwHostname: 'www.example.net',
    principal: 'root',
    principalHostname: 'example.net',
    status: 'PENDING',
    recordName: '_check.example.net',
    dnsRecords: {
      verification: { type: 'TXT', name: '_check', fqdn: '_check.example.net', values: ['tok'] },
      pointing: [{ type: 'A', name: '@', fqdn: 'example.net', values: ['203.0.113.10'] }],
    },
    dnsPointsHere: null,
    canonical: false,
    archived: false,
    archivedAt: null,
    archivedBy: null,
    verifiedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function writes(errors: { key: string; message: string; input: { kind: 'verify' | 'restore' | 'principal' | 'remove'; domain: TenantDomainItem } }[] = []) {
  return {
    writes: { errors, isPending: () => false, dismiss: vi.fn() },
    run: vi.fn(),
    remove: vi.fn(async () => undefined),
  };
}

function Card(props: { domains: TenantDomainItem[]; removed?: TenantDomainItem[]; host?: ReturnType<typeof writes> }): ReactNode {
  return (
    <screenOf.DomainsCard
      domains={props.domains}
      removed={props.removed ?? []}
      dnsTargets={['203.0.113.10']}
      disabled={false}
      copy={PACK}
      writes={props.host ?? writes()}
    />
  );
}

describe('the domains screen', () => {
  it('with no domain: the empty state and the address to have ready, in the host pack', () => {
    render(<Card domains={[]} />);
    expect(screen.getByTestId('domains-card')).toBeTruthy();
    expect(screen.getByText('«emptyTitle»')).toBeTruthy();
    expect(screen.getByText('«point A»')).toBeTruthy();
  });

  it('a pending pair: its name, status, the records and the two buttons, all from the pack', () => {
    const host = writes();
    render(<Card domains={[item()]} host={host} />);
    expect(screen.getByTestId('domain-row').getAttribute('aria-label')).toBe('«pair example.net»');
    expect(screen.getByTestId('domain-status').textContent).toBe('«waiting»');
    expect(screen.getByText('«txtPair»')).toBeTruthy();
    expect(screen.getByTestId('domain-verify').textContent).toBe('«verifyNow»');
    expect(screen.getByTestId('domain-remove').textContent).toBe('«removeNow»');
    // A pending pair's removal says the PAIR pack's sentence, never the records' one.
    expect(screen.getByTestId('domain-remove').getAttribute('data-confirm')).toBe('«pairRemoveList»');
    fireEvent.click(screen.getByTestId('domain-verify'));
    expect(host.run).toHaveBeenCalledWith({ kind: 'verify', domain: expect.objectContaining({ id: 'd1' }) });
    fireEvent.click(screen.getByText('www.example.net'));
    expect(host.run).toHaveBeenCalledWith({ kind: 'principal', domain: expect.objectContaining({ id: 'd1' }), principal: 'www' });
  });

  it('an ACTIVE pair whose DNS points elsewhere: the qualified status and the warning', () => {
    render(<Card domains={[item({ status: 'ACTIVE', dnsPointsHere: false })]} />);
    expect(screen.getByTestId('domain-status').textContent).toBe('«active»«elsewhere»');
    expect(screen.getByTestId('domain-not-pointed').textContent).toContain('«notPointed»');
    expect(screen.getByTestId('domain-row').textContent).not.toContain('«verifyNow»');
  });

  it('a refusal is told in its own row; the removed list restores', () => {
    const domain = item();
    const removed = item({ id: 'r1', hostname: 'old.net', wwwHostname: null, archived: true, archivedAt: '2026-02-03T12:00:00Z' });
    const host = writes([{ key: 'd1', message: 'refused here', input: { kind: 'verify', domain } }]);
    render(<Card domains={[domain]} removed={[removed]} host={host} />);
    expect(screen.getByTestId('domains-error').textContent).toContain('refused here');
    expect(screen.getByTestId('domains-removed-toggle').textContent).toContain('«removed 1»');
    fireEvent.click(screen.getByTestId('domain-restore'));
    expect(host.run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'restore', domain: removed }));
  });

  it('the records render standalone, with their own copy', () => {
    render(<PointingRecord dnsTargets={['203.0.113.10', '2001:db8::1']} numbered copy={PACK.records} />);
    expect(screen.getAllByText('«label AAAA»').length).toBeGreaterThan(0);
  });

  it('the pair note before a claim', () => {
    render(<screenOf.PairAnnouncement root="example.net" www="www.example.net" copy={PACK.pair} />);
    expect(screen.getByTestId('domain-pair-announcement').textContent).toContain('«both»');
  });
});

describe('createDomainsScreen config', () => {
  const keyOf = (build: () => unknown): string => {
    try {
      build();
    } catch (error) {
      expect(error).toBeInstanceOf(TenantConfigError);
      return (error as TenantConfigError).key;
    }
    throw new Error('expected a TenantConfigError');
  };

  it('names a missing key of a pack', () => {
    const records: Record<string, unknown> = { ...PACK.records };
    delete records.verifyAction;
    const copy = { locales: { 'x-test': { ...PACK, records } as unknown as TenantDomainsCopy }, defaultLocale: 'x-test' };
    expect(keyOf(() => createDomainsScreen({ copy, components }))).toBe('domainsScreen.copy.locales.x-test.records.verifyAction');
  });

  it('names a sentence given as text, and a widget left out', () => {
    const pair = { ...PACK.pair, pairName: 'not a function' } as unknown as TenantDomainsCopy['pair'];
    const copy = { locales: { 'x-test': { ...PACK, pair } }, defaultLocale: 'x-test' };
    expect(keyOf(() => createDomainsScreen({ copy, components }))).toBe('domainsScreen.copy.locales.x-test.pair.pairName');
    const ok = { locales: { 'x-test': PACK }, defaultLocale: 'x-test' };
    expect(
      keyOf(() => createDomainsScreen({ copy: ok, components: { Segmented: components.Segmented } as TenantDomainsComponents })),
    ).toBe('domainsScreen.components.ConfirmButton');
    expect(keyOf(() => createDomainsScreen({ copy: { ...ok, defaultLocale: 'fr' }, components }))).toBe(
      'domainsScreen.copy.defaultLocale',
    );
  });
});
