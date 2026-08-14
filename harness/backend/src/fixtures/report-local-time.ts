/**
 * THIS HOST's merchant-local derivations for its `hourOfDay` / `dayOfWeek`
 * dimensions.
 *
 * They used to be imported from the package (`dayOfWeekSaoPaulo`,
 * `hourOfDaySaoPaulo`) — two functions hardcoding `America/Sao_Paulo` and a
 * pt-BR weekday map (`1-seg` … `7-dom`), shipped from a library every host
 * installs. A derived dimension is the host's: which zone its merchants keep,
 * and how it encodes a weekday so the values sort as strings, are decisions
 * only the host's catalog can make. So the formulas live here, beside the
 * fixture rows that carry them and the catalog that declares them `ordered`.
 *
 * The zone is `HARNESS_TIME_ZONE`, stated once for the mount, the fixture and
 * these derivations together — the same-clock rule, applied to a host.
 */
import { HARNESS_TIME_ZONE } from './report-fixture-window';

const hourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: HARNESS_TIME_ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: HARNESS_TIME_ZONE,
  weekday: 'short',
});

/** ISO weekday order with pt-BR abbreviations; prefixed so sorts read Mon→Sun. */
const WEEKDAY_LABELS: Record<string, string> = {
  Mon: '1-seg',
  Tue: '2-ter',
  Wed: '3-qua',
  Thu: '4-qui',
  Fri: '5-sex',
  Sat: '6-sáb',
  Sun: '7-dom',
};

/** Local hour of day, zero-padded "00"–"23". */
export function localHourOfDay(instant: Date): string {
  return hourFormatter.format(instant);
}

/** Local day of week, "1-seg" (segunda) through "7-dom" (domingo). */
export function localDayOfWeek(instant: Date): string {
  return WEEKDAY_LABELS[weekdayFormatter.format(instant)] ?? '?';
}
