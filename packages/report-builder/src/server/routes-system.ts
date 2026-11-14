import { runReport } from '../run';
import type { TimeGrain } from '../types';

import {
  messagesOf,
  fail,
  foldSpecError,
  forbidden,
  ok,
  runOptions,
  toReportRangeView,
  type ReportBuilderServerConfig,
  type ReportRoute,
} from './context';
import { windowOfQuery } from './range-query';
import type { SystemReportDef } from './system-reports';
import { REPORT_GRAINS } from './wire';
import { REPORT_BUILDER_FEATURES } from './features';

/**
 * The built-in ("system") reports: hardcoded, non-editable presets over the
 * SAME engine custom reports use.
 *
 * They were the last two endpoints still living in the host, and the reason
 * the host could not drop its route folder: a preset's spec, its permission
 * and its grain all come from this package, so a host route was doing nothing
 * but reading three package constants and calling one package function.
 */

/** The grain a request asks for, defaulted the way the wire schema does. */
function grainOf(query: Record<string, string | undefined>): TimeGrain {
  return REPORT_GRAINS.find((candidate) => candidate === query.grain) ?? 'day';
}

/** What the hub card needs — deliberately not the whole definition. */
function toSystemSummary(report: SystemReportDef): {
  key: string;
  title: string;
  description: string;
  presentation: 'chart' | 'table';
  supportsGrain: boolean;
  grains?: readonly TimeGrain[];
} {
  return {
    key: report.key,
    title: report.title,
    description: report.description,
    presentation: report.presentation,
    supportsGrain: report.supportsGrain,
    ...(report.grains ? { grains: report.grains } : {}),
  };
}

/** The built-ins this actor may run. Holding none is a 403, not an empty list. */
function systemListRoute(config: ReportBuilderServerConfig): ReportRoute {
  return {
    method: 'GET',
    path: '/reports/system',
    entitlement: REPORT_BUILDER_FEATURES.system,
    handle({ actor }) {
      const presets = config.systemReports;
      const reports = presets
        .filter((report) => actor.permissions.includes(report.permission))
        .map(toSystemSummary);
      // An actor who may run none of them cannot see the area at all — the
      // same answer the entity narrowing gives on `/reports/fields`. A host
      // that serves NO presets is a different thing, and answers an empty list.
      const response = reports.length === 0 && presets.length > 0 ? forbidden(config) : ok({ reports });
      return Promise.resolve(response);
    },
  };
}

/** Run one built-in for the requested period and grain. */
function systemRunRoute(config: ReportBuilderServerConfig): ReportRoute {
  return {
    method: 'GET',
    path: '/reports/system/:key',
    entitlement: REPORT_BUILDER_FEATURES.system,
    async handle({ actor, params, query, locale }) {
      const report = config.systemReports.find((candidate) => candidate.key === params.key);
      // An unknown key is 404 before the permission check: there is no id to
      // disclose here, and a 403 on a key that does not exist reads as "you
      // nearly had it".
      if (!report) return fail(404, messagesOf(config, locale).notFound);
      if (!actor.permissions.includes(report.permission)) return forbidden(config);

      const grain = grainOf(query);
      try {
        const range = windowOfQuery(config, { query, locale });
        const window = { from: range.from, toExclusive: range.toExclusive };
        // Before the run: the tenant's own numbers are what the spec is BUILT
        // with (FUT-4063), so they have to exist before `build` does.
        const derived = report.derive ? await report.derive({ actor, window, grain }) : {};
        const result = await runReport(
          report.build({ grain, params: derived.params ?? {} }),
          await runOptions(config, actor, range, locale),
        );
        return ok({
          key: report.key,
          title: report.title,
          description: report.description,
          supportsGrain: report.supportsGrain,
          ...(report.grains ? { grains: report.grains } : {}),
          range: toReportRangeView(range),
          grain,
          render: result.render,
          notes: derived.notes ?? [],
        });
      } catch (error) {
        return foldSpecError(error);
      }
    },
  };
}

export function systemRoutes(config: ReportBuilderServerConfig): ReportRoute[] {
  return [systemListRoute(config), systemRunRoute(config)];
}
