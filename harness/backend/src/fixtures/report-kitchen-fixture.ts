/**
 * The harness fixture's KITCHEN: `kitchen_ticket_items` (one row per finished
 * line) and `kitchen_shifts` (one row per cook's shift at a station).
 *
 * These are the two entities the "Movimento" templates target, and the two the
 * harness could not run at all — so the picker offered "Tempo de preparo por
 * estação" and "Horas trabalhadas por estação" and both came back refused.
 *
 * Generated rather than listed, for a reason the catalog itself imposes:
 * `prepSeconds` carries `identityMinSample` (20), so a station's p90 is
 * WITHHELD until it has twenty eligible lines. A fixture small enough to type
 * out by hand renders "—" in every cell and looks broken while behaving
 * exactly as the product does. Sixty lines make the rule legible instead:
 * Chapa and Fritadeira clear the floor and show a number, Montagem does not
 * and shows the placeholder — the suppression demonstrated rather than
 * described.
 *
 * The shifts are derived FROM the same plan as the lines, so a station's
 * "linhas produzidas" cannot disagree with the lines that produced them.
 */
import { dayOfWeekSaoPaulo, hourOfDaySaoPaulo } from '@12-apps/report-builder/server';

import { saoPauloInstant, secondsBefore, type FixtureRow } from './report-fixture-window';

const TODAY = '2026-07-05';
const SECONDS_PER_HOUR = 3600;

/** Where the work happens, what it makes, and how long it takes there. */
interface StationPlan {
  station: string;
  /** Two products, alternated, so `productName` is worth grouping by. */
  products: readonly [string, string];
  /** Local day and how many lines were finished on it. */
  days: ReadonlyArray<readonly [day: string, lines: number]>;
  /** Seconds of preparo, cycled across the station's lines. */
  prep: readonly number[];
  /** Seconds of espera na fila, cycled the same way. */
  wait: readonly number[];
}

/**
 * Three stations, sized to straddle the suppression floor.
 *
 * The day lists also keep the period toggle honest on this entity: 8 lines
 * today ⊂ 54 in seven days ⊂ 59 in thirty, so a preset that silently resolved
 * to another one would change the count.
 */
const PLANS: readonly StationPlan[] = [
  {
    station: 'Chapa',
    products: ['X-Burger', 'X-Salada'],
    days: [
      ['2026-06-15', 3],
      ['2026-06-29', 4],
      ['2026-06-30', 4],
      ['2026-07-01', 4],
      ['2026-07-02', 4],
      ['2026-07-03', 4],
      ['2026-07-04', 4],
      [TODAY, 4],
    ],
    prep: [240, 300, 210, 360, 270],
    wait: [60, 120, 180, 90],
  },
  {
    station: 'Fritadeira',
    products: ['Batata frita', 'Onion rings'],
    days: [
      ['2026-06-20', 2],
      ['2026-07-01', 4],
      ['2026-07-02', 4],
      ['2026-07-03', 4],
      ['2026-07-04', 4],
      [TODAY, 4],
    ],
    prep: [180, 150, 210, 240],
    wait: [45, 90, 150],
  },
  {
    // Under the floor on every preset — the station whose p90 reads "—".
    station: 'Montagem',
    products: ['Pastel de queijo', 'Coxinha'],
    days: [
      ['2026-07-02', 3],
      ['2026-07-04', 3],
    ],
    prep: [90, 120, 150],
    wait: [30, 60],
  },
];

/** Service starts at 06:00 and a line lands every 40 minutes — 06:00 to 08:00. */
const FIRST_LINE_HOUR = 6;
const LINE_STEP_MINUTES = 40;
const MINUTES_PER_HOUR = 60;

const cycled = (values: readonly number[], index: number): number =>
  values[index % values.length] ?? 0;

/** How many portions the n-th line of a day carried: 1, 2, 3, 1, 2, 3, … */
const portionsOf = (index: number): number => 1 + (index % 3);

function lineRow(plan: StationPlan, day: string, index: number, ordinal: number): FixtureRow {
  const minutes = index * LINE_STEP_MINUTES;
  const readyAt = saoPauloInstant(
    day,
    FIRST_LINE_HOUR + Math.floor(minutes / MINUTES_PER_HOUR),
    minutes % MINUTES_PER_HOUR,
  );
  const prepSeconds = cycled(plan.prep, ordinal);
  const waitSeconds = cycled(plan.wait, ordinal);
  return {
    readyAt,
    sentAt: secondsBefore(readyAt, prepSeconds + waitSeconds),
    // Derived with the package's own `local-time` helpers, so the encodings
    // that make these sort correctly as strings cannot drift from the ones the
    // product produces.
    completionHourOfDay: hourOfDaySaoPaulo(new Date(readyAt)),
    completionDayOfWeek: dayOfWeekSaoPaulo(new Date(readyAt)),
    stationName: plan.station,
    productName: plan.products[index % 2] ?? plan.products[0],
    // One line is ONE observation whatever the quantity: the quantity weighs
    // on production and never on the timings.
    lines: 1,
    quantity: portionsOf(index),
    waitSeconds,
    prepSeconds,
  };
}

function linesOfPlan(plan: StationPlan): FixtureRow[] {
  return plan.days
    .flatMap(([day, count]) => Array.from({ length: count }, (_, index) => ({ day, index })))
    .map((slot, ordinal) => lineRow(plan, slot.day, slot.index, ordinal));
}

/**
 * `kitchen_ticket_items`.
 *
 * The demand-side hour/weekday pair, the attribution fields and the
 * plan/promise measures are left out — see the catalog module for what the
 * harness models and what it does not.
 */
export const KITCHEN_TICKET_ITEMS: FixtureRow[] = PLANS.flatMap(linesOfPlan);

interface ShiftShape {
  endedReason: string;
  closed: boolean;
  autoClosed: boolean;
  laborSeconds: number;
}

/** A normal day: 05:30 to 11:30, closed by the cook who worked it. */
const WORKED_AND_CLOSED: ShiftShape = {
  endedReason: 'Cozinheiro',
  closed: true,
  autoClosed: false,
  laborSeconds: 6 * SECONDS_PER_HOUR,
};

/** Today: opened at 05:30 and still open at the frozen clock's 09:00. */
const STILL_OPEN: ShiftShape = {
  endedReason: 'Em aberto',
  closed: false,
  autoClosed: false,
  laborSeconds: 3.5 * SECONDS_PER_HOUR,
};

/**
 * The exceptions, by station and day.
 *
 * `Automático` is the shift nobody closed: a 16-hour automatic close is not a
 * 16-hour shift, and `autoClosed` exists so the reader can tell one from the
 * other — this row is what gives the flag something to be true of.
 */
const SHIFT_SHAPES: Record<string, ShiftShape> = {
  'Fritadeira|2026-07-03': {
    endedReason: 'Automático',
    closed: true,
    autoClosed: true,
    laborSeconds: 16 * SECONDS_PER_HOUR,
  },
  'Montagem|2026-06-30': {
    endedReason: 'Supervisor',
    closed: true,
    autoClosed: false,
    laborSeconds: 4 * SECONDS_PER_HOUR,
  },
};

const SHIFT_START_HOUR = 5;
const SHIFT_START_MINUTE = 30;

interface ShiftFact {
  station: string;
  day: string;
  lines: number;
  quantity: number;
}

/**
 * One shift per station per day it produced — plus the one that produced
 * NOTHING.
 *
 * Derived shifts can only ever describe stations that produced, and "quem não
 * produziu ainda custou a hora" is the whole reason labour is counted apart
 * from output. So `Montagem` on 30/06 is declared: four hours, zero lines.
 */
function shiftFacts(): ShiftFact[] {
  const worked = PLANS.flatMap((plan) =>
    plan.days.map(([day, lines]) => ({
      station: plan.station,
      day,
      lines,
      quantity: Array.from({ length: lines }, (_, index) => portionsOf(index)).reduce(
        (total, portions) => total + portions,
        0,
      ),
    })),
  );
  return [...worked, { station: 'Montagem', day: '2026-06-30', lines: 0, quantity: 0 }];
}

const shapeOf = (fact: ShiftFact): ShiftShape =>
  SHIFT_SHAPES[`${fact.station}|${fact.day}`] ??
  (fact.day === TODAY ? STILL_OPEN : WORKED_AND_CLOSED);

/** `kitchen_shifts` — the labour side, and the denominator of any productivity read. */
export const KITCHEN_SHIFTS: FixtureRow[] = shiftFacts().map((fact) => {
  const shape = shapeOf(fact);
  return {
    startedAt: saoPauloInstant(fact.day, SHIFT_START_HOUR, SHIFT_START_MINUTE),
    stationName: fact.station,
    endedReason: shape.endedReason,
    autoClosed: shape.autoClosed,
    closed: shape.closed,
    shifts: 1,
    closedShifts: shape.closed ? 1 : 0,
    laborSeconds: shape.laborSeconds,
    laborHours: shape.laborSeconds / SECONDS_PER_HOUR,
    outputLines: fact.lines,
    outputQuantity: fact.quantity,
  };
});
