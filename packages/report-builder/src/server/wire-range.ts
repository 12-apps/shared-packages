import { z } from 'zod';

import { reportSpecSchema } from '../spec';

import type { ReportRangeMessages } from './messages';
import { REPORT_MAX_RANGE_DAYS, REPORT_RANGE_PRESETS } from './range';
import { REPORT_GRAINS } from './wire';

/**
 * The wire schemas whose refusals are COPY.
 *
 * Split from `wire.ts` because they are the only ones a host's words reach:
 * every schema there is a pure shape, while each of these carries sentences a
 * person reads when their period is wrong. They are factories for that reason —
 * a module-scope constant would have to bake in one language, which is the
 * default this package no longer ships.
 */

/**
 * A calendar date (`YYYY-MM-DD`), interpreted at UTC midnight by the API.
 *
 * A factory rather than a constant because its two refusals are COPY, and copy
 * is the host's. Every schema below that carries a date is a factory for the
 * same reason.
 */
function isoDateSchema(messages: ReportRangeMessages) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, messages.isoFormat)
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), messages.invalidDate);
}

function spanInDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return ms / (24 * 60 * 60 * 1000) + 1;
}

interface CustomRangeFields {
  preset: string;
  from?: string;
  to?: string;
}

/** The custom-range rules, applied to every schema that carries a window. */
function withRangeRules<T extends z.ZodType<CustomRangeFields>>(
  schema: T,
  messages: ReportRangeMessages,
): T {
  return schema
    .refine((value) => value.preset !== 'custom' || (value.from && value.to), {
      message: messages.customNeedsBothDates,
      path: ['from'],
    })
    .refine(
      (value) => value.preset !== 'custom' || !value.from || !value.to || value.from <= value.to,
      { message: messages.endBeforeStart, path: ['to'] },
    )
    .refine(
      (value) =>
        value.preset !== 'custom' ||
        !value.from ||
        !value.to ||
        spanInDays(value.from, value.to) <= REPORT_MAX_RANGE_DAYS,
      { message: messages.tooLong(REPORT_MAX_RANGE_DAYS), path: ['to'] },
    ) as unknown as T;
}

/** Report window + grain (rolling presets or an inclusive custom range). */
export function reportRangeQuery(messages: ReportRangeMessages) {
  const date = isoDateSchema(messages);
  return withRangeRules(
    z.object({
      preset: z.enum(REPORT_RANGE_PRESETS).default('30d'),
      from: date.optional(),
      to: date.optional(),
      grain: z.enum(REPORT_GRAINS).default('day'),
    }),
    messages,
  );
}

/** Body of a dry run: the declarative spec plus the window. */
export function runReportBody(messages: ReportRangeMessages) {
  const date = isoDateSchema(messages);
  return withRangeRules(
    z.object({
      spec: reportSpecSchema,
      preset: z.enum(REPORT_RANGE_PRESETS).default('30d'),
      from: date.optional(),
      to: date.optional(),
    }),
    messages,
  );
}
