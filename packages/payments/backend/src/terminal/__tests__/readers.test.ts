import { describe, expect, it } from 'vitest';

import { captureFitsLeg, distinctCaptures, readDeviceCaptureReport, readStationCaptureWire } from '../readers';

/**
 * The hand-written strict readers, held to what the origin host's schemas
 * accepted: an unknown key refused, text trimmed and held to its length, an
 * integer amount within the host's ceiling, an ISO date-time with an offset.
 */

const limits = { maxAmountCents: 100_000_000 };
const report = { transactionCode: ' TC-1 ', kind: 'CREDIT', amountCents: 2500 };
const station = { ...report, capturedAt: '2026-11-03T15:00:00.000Z' };

describe('the device report', () => {
  it('reads the minimal report, trimming its text, and leaves absent fields absent', () => {
    expect(readDeviceCaptureReport(report, limits)).toEqual({ ok: true, value: { transactionCode: 'TC-1', kind: 'CREDIT', amountCents: 2500 } });
  });

  it('reads the whole trace, nulls included', () => {
    const full = {
      ...report,
      capturedAt: '2026-11-03T12:00:00-03:00',
      transactionId: 'T'.repeat(128),
      hostNsu: null,
      authorizationCode: ' A1 ',
      cardBrand: 'VISA',
      installments: 99,
      terminalSerial: 'S',
      entryMode: null,
    };
    expect(readDeviceCaptureReport(full, limits)).toEqual({ ok: true, value: { ...full, transactionCode: 'TC-1', authorizationCode: 'A1' } });
  });

  it.each([
    ['an unknown key', { ...report, deviceId: 'd-1' }],
    ['a tenant named in the body', { ...report, clientId: 'x' }],
    ['a missing code', { kind: 'CREDIT', amountCents: 1 }],
    ['a blank code', { ...report, transactionCode: '   ' }],
    ['a code over 64', { ...report, transactionCode: 'x'.repeat(65) }],
    ['an unknown kind', { ...report, kind: 'CASH' }],
    ['a zero amount', { ...report, amountCents: 0 }],
    ['a fractional amount', { ...report, amountCents: 1.5 }],
    ['an amount over the ceiling', { ...report, amountCents: 100_000_001 }],
    ['an amount as text', { ...report, amountCents: '2500' }],
    ['a date with no offset', { ...report, capturedAt: '2026-11-03T15:00:00' }],
    ['a date with no time', { ...report, capturedAt: '2026-11-03' }],
    ['an impossible date', { ...report, capturedAt: '2026-02-30T15:00:00Z' }],
    ['a capture time of null', { ...report, capturedAt: null }],
    ['installments of zero', { ...report, installments: 0 }],
    ['installments over 99', { ...report, installments: 100 }],
    ['a card brand over 32', { ...report, cardBrand: 'x'.repeat(33) }],
    ['a blank trace field', { ...report, hostNsu: ' ' }],
    ['an array', [report]],
    ['null', null],
  ])('refuses %s', (_name, input) => {
    expect(readDeviceCaptureReport(input, limits).ok).toBe(false);
  });

  it('holds the amount to the ceiling it is given', () => {
    expect(readDeviceCaptureReport({ ...report, amountCents: 1000 }, { maxAmountCents: 999 })).toMatchObject({ ok: false });
    expect(readDeviceCaptureReport({ ...report, amountCents: 999 }, { maxAmountCents: 999 })).toMatchObject({ ok: true });
  });

  it('names each issue', () => {
    expect(readDeviceCaptureReport({ ...report, kind: 'CASH', extra: 1 }, limits)).toEqual({
      ok: false,
      issues: ['extra: unknown key', 'kind: expected one of CREDIT, DEBIT, PIX'],
    });
  });
});

describe('the station wire', () => {
  it('reads the capture with its terminal, trimmed', () => {
    expect(readStationCaptureWire({ ...station, deviceId: ' d-1 ' }, limits)).toEqual({
      ok: true,
      value: { transactionCode: 'TC-1', kind: 'CREDIT', amountCents: 2500, capturedAt: station.capturedAt, deviceId: 'd-1' },
    });
    expect(readStationCaptureWire({ ...station, deviceId: null }, limits)).toMatchObject({ ok: true, value: { deviceId: null } });
  });

  it('requires the capture time, and refuses an unknown key or a terminal id over 64', () => {
    expect(readStationCaptureWire(report, limits)).toEqual({ ok: false, issues: ['capturedAt: required'] });
    expect(readStationCaptureWire({ ...station, store: 'x' }, limits).ok).toBe(false);
    expect(readStationCaptureWire({ ...station, deviceId: 'd'.repeat(65) }, limits).ok).toBe(false);
  });
});

describe('a terminal leg', () => {
  const capture = { transactionCode: 'A', kind: 'PIX' as const, amountCents: 300, capturedAt: station.capturedAt };

  it('is exactly its capture: the same kind and the same amount', () => {
    expect(captureFitsLeg({ tender: 'CASH' })).toBe(true);
    expect(captureFitsLeg({ tender: 'PIX', amountCents: 300, capture })).toBe(true);
    expect(captureFitsLeg({ tender: 'CREDIT', amountCents: 300, capture })).toBe(false);
    expect(captureFitsLeg({ tender: 'PIX', amountCents: 299, capture })).toBe(false);
    expect(captureFitsLeg({ tender: 'PIX', capture })).toBe(false);
  });

  it('carries a code at most once per request', () => {
    expect(distinctCaptures([{ tender: 'PIX', capture }, { tender: 'CASH' }, { tender: 'PIX', capture: { ...capture, transactionCode: 'B' } }])).toBe(true);
    expect(distinctCaptures([{ tender: 'PIX', capture }, { tender: 'PIX', capture }])).toBe(false);
  });
});
