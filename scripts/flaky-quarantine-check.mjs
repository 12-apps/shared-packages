#!/usr/bin/env node
/**
 * Validates flaky-quarantine.json — the time-bound, ticket-tracked list of e2e
 * tests temporarily skipped at runtime (via Playwright grepInvert; see
 * playwright.config.ts). A quarantine is a debt, not a hiding place: every entry
 * must cite a ticket and carry an expiry, and this gate fails CI on any entry
 * that is malformed, expired, or points at a spec that no longer exists — so
 * quarantined tests get un-quarantined instead of rotting silently.
 *
 * Entry shape:
 *   {
 *     "spec": "apps/web/tests/e2e/checkout.spec.ts",
 *     "titlePattern": "completes a PIX checkout",
 *     "reason": "PIX QR intermittently detaches — see ticket",
 *     "ticket": "FUT-123",
 *     "addedAt": "2026-07-07",
 *     "expiresAt": "2026-08-07",
 *     "addedBy": "you@example.com"
 *   }
 *
 * Exit 0 when the list is empty or every entry is valid; exit 1 otherwise.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "flaky-quarantine.json");
const TICKET_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED = ["spec", "titlePattern", "reason", "ticket", "addedAt", "expiresAt"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

let entries;
try {
  entries = JSON.parse(readFileSync(FILE, "utf8"));
} catch (err) {
  console.error(`[flaky-quarantine] cannot read/parse flaky-quarantine.json: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(entries)) {
  console.error("[flaky-quarantine] flaky-quarantine.json must be a JSON array.");
  process.exit(1);
}

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";

function missingFields(entry) {
  return REQUIRED.filter((key) => isBlank(entry[key])).map(
    (key) => `missing required field "${key}"`,
  );
}

function badTicket(entry) {
  if (isBlank(entry.ticket) || TICKET_RE.test(entry.ticket)) return [];
  return [`ticket "${entry.ticket}" is not a PROJECT-NUMBER id`];
}

function badDates(entry) {
  return ["addedAt", "expiresAt"]
    .filter((key) => !isBlank(entry[key]) && !DATE_RE.test(entry[key]))
    .map((key) => `${key} "${entry[key]}" is not YYYY-MM-DD`);
}

function expired(entry, now) {
  const bad = !isBlank(entry.expiresAt) && DATE_RE.test(entry.expiresAt) && entry.expiresAt < now;
  if (!bad) return [];
  return [`expired on ${entry.expiresAt} — fix the test and remove it, or re-up the ticket`];
}

function missingSpec(entry) {
  if (isBlank(entry.spec) || existsSync(join(ROOT, entry.spec))) return [];
  return [`spec "${entry.spec}" does not exist`];
}

// The titlePattern is compiled into a Playwright grepInvert RegExp; a pattern
// that doesn't compile would silently disable the whole quarantine at runtime,
// so reject it here at the gate.
function badPattern(entry) {
  if (isBlank(entry.titlePattern)) return [];
  try {
    new RegExp(entry.titlePattern);
    return [];
  } catch (err) {
    return [`titlePattern is not a valid regex: ${err.message}`];
  }
}

function validateEntry(rawEntry, i, now) {
  const entry = rawEntry ?? {};
  const where = `entry #${i}${entry.ticket ? ` (${entry.ticket})` : ""}`;
  return [
    ...missingFields(entry),
    ...badTicket(entry),
    ...badDates(entry),
    ...expired(entry, now),
    ...missingSpec(entry),
    ...badPattern(entry),
  ].map((msg) => `${where}: ${msg}`);
}

const now = today();
const problems = entries.flatMap((entry, i) => validateEntry(entry, i, now));

if (problems.length > 0) {
  console.error("[flaky-quarantine] invalid quarantine entries:");
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}

console.log(
  `[flaky-quarantine] ${entries.length} quarantined test(s), all valid. ✅`,
);
