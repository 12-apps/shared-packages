import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  diagnoseWebhookSigner,
  type SignerCandidate,
} from '../providers/pagbank-webhook-signer';

const sign = (secret: string, rawBody: string): string =>
  createHash('sha256').update(`${secret}-${rawBody}`).digest('hex');

const RAW_BODY = '{"id":"ORDE_1","charges":[{"id":"CHAR_1","status":"PAID"}]}';

const CANDIDATES: SignerCandidate[] = [
  { label: 'store token (SANDBOX)', secret: 'store-sandbox-token' },
  { label: 'platform token', secret: 'platform-token' },
  { label: 'webhookToken override', secret: 'override-secret' },
  { label: 'application client_secret', secret: 'app-client-secret' },
];

describe('diagnoseWebhookSigner (FUT-678)', () => {
  it('Given a delivery signed with the store token, Then the store label matches alone', () => {
    const diagnosis = diagnoseWebhookSigner(
      {
        headers: { 'x-authenticity-token': sign('store-sandbox-token', RAW_BODY) },
        rawBody: RAW_BODY,
      },
      CANDIDATES,
    );
    expect(diagnosis.matches).toEqual(['store token (SANDBOX)']);
  });

  it('Given a delivery signed with the platform token, Then only the platform label matches', () => {
    const diagnosis = diagnoseWebhookSigner(
      {
        headers: { 'x-authenticity-token': sign('platform-token', RAW_BODY) },
        rawBody: RAW_BODY,
      },
      CANDIDATES,
    );
    expect(diagnosis.matches).toEqual(['platform token']);
  });

  it('Given a signer outside the candidate set, Then no label matches but every digest is reported', () => {
    const diagnosis = diagnoseWebhookSigner(
      {
        headers: { 'x-authenticity-token': sign('somebody-else', RAW_BODY) },
        rawBody: RAW_BODY,
      },
      CANDIDATES,
    );
    expect(diagnosis.matches).toEqual([]);
    expect(Object.keys(diagnosis.digests)).toHaveLength(CANDIDATES.length);
    for (const digest of Object.values(diagnosis.digests)) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('Given a delivery with no authenticity header, Then presented is null and nothing matches', () => {
    const diagnosis = diagnoseWebhookSigner({ headers: {}, rawBody: RAW_BODY }, CANDIDATES);
    expect(diagnosis.presented).toBeNull();
    expect(diagnosis.matches).toEqual([]);
  });

  it('Given the header under a different casing, Then it is still read', () => {
    const diagnosis = diagnoseWebhookSigner(
      {
        headers: { 'X-Authenticity-Token': sign('override-secret', RAW_BODY) },
        rawBody: RAW_BODY,
      },
      CANDIDATES,
    );
    expect(diagnosis.matches).toEqual(['webhookToken override']);
  });

  it('Given an uppercase presented digest, Then comparison is case-insensitive', () => {
    const diagnosis = diagnoseWebhookSigner(
      {
        headers: { 'x-authenticity-token': sign('platform-token', RAW_BODY).toUpperCase() },
        rawBody: RAW_BODY,
      },
      CANDIDATES,
    );
    expect(diagnosis.matches).toEqual(['platform token']);
  });

  it('Given a re-serialized body, Then the digest no longer matches — raw bytes are the contract', () => {
    const reserialized = JSON.stringify(JSON.parse(RAW_BODY), null, 2);
    const diagnosis = diagnoseWebhookSigner(
      {
        headers: { 'x-authenticity-token': sign('platform-token', RAW_BODY) },
        rawBody: reserialized,
      },
      CANDIDATES,
    );
    expect(diagnosis.matches).toEqual([]);
  });

  it('Given two candidates holding the same secret, Then both labels match', () => {
    const diagnosis = diagnoseWebhookSigner(
      {
        headers: { 'x-authenticity-token': sign('shared', RAW_BODY) },
        rawBody: RAW_BODY,
      },
      [
        { label: 'store token', secret: 'shared' },
        { label: 'platform token', secret: 'shared' },
      ],
    );
    expect(diagnosis.matches).toEqual(['store token', 'platform token']);
  });
});
