import { expect, type Page } from '@playwright/test';

import { paymentsWorld } from '../world.js';

/**
 * Whether a wire probe's text records only reads (FUT-4028): one or more
 * requests, every one of them a `GET <path>`.
 *
 * Parsed rather than matched with one pattern: the probe's text is split on
 * the separators a host may use (`,` or a new line) and each entry is checked
 * on its own, so nothing here can backtrack, whatever the probe printed.
 */
export function onlyReads(text: string): boolean {
  const entries = wireEntries(text);
  return entries.length > 0 && entries.every((entry) => isRead(entry));
}

/**
 * Whether a wire probe's text records no write: every request it holds, if
 * any, is a `GET <path>`. An empty probe passes — a host that draws "não
 * cobra online" from what it already knows reads nothing at all (FUT-4028).
 */
export function noWrites(text: string): boolean {
  return wireEntries(text).every((entry) => isRead(entry));
}

/** The probe's entries, split on the separators a host may use (`,` or a new line). */
function wireEntries(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** `GET` and a path with no whitespace in it — `GET /api/checkout/config`. */
function isRead(entry: string): boolean {
  const [verb, path, ...rest] = entry.split(' ').filter((part) => part !== '');
  return verb === 'GET' && path !== undefined && rest.length === 0 && !/\s/.test(path);
}

/**
 * Nothing that writes reached the wire — no order, no charge (FUT-4028). What
 * "nenhum pedido chegou a ser criado" proves. It does NOT require the config
 * read: a host may know the store cannot charge without asking.
 */
export async function expectNoWrites(page: Page): Promise<void> {
  const paths = paymentsWorld().wire.paths(page);
  await expect.poll(async () => noWrites((await paths.textContent()) ?? '')).toBe(true);
}

/**
 * The wire carried the config read and nothing that writes (FUT-4028). For a
 * scenario whose premise IS that the config was read and answered. A read
 * beside it is no payable: the list also reads the buyer's saved cards
 * (`GET /api/checkout/cards`), where the tabs read the config alone. Every
 * recorded line is a GET, however a host separates them (`,` or a new line).
 */
export async function expectOnlyReads(page: Page): Promise<void> {
  const paths = paymentsWorld().wire.paths(page);
  await expect(paths).toContainText('GET /api/checkout/config');
  await expect.poll(async () => onlyReads((await paths.textContent()) ?? '')).toBe(true);
}
