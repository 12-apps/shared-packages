import { compileReport } from '../compile';
import { reportSpecSchema } from '../spec';
import { ReportBuilderError } from '../errors';
import { isValidTimeZone } from '../time';

import type { ReportBuilderServerConfig } from './context';

/**
 * The wiring check that runs ONCE, when the host builds the surface.
 *
 * Every rule here used to be a DEFAULT — a `??` that answered the question for
 * a host which had not answered it. That is the failure this module exists to
 * make impossible: a host that says nothing about which permission guards its
 * `orders` entity, or which clock its tenants keep, must be told so at the call
 * site rather than quietly inherit the application this package was extracted
 * from. Reports would still render; they would render another store's policy.
 *
 * It throws at ASSEMBLY, not per request, for the same reason
 * `composePermissions` does: a misconfiguration that only shows up on the one
 * endpoint nobody exercised is a misconfiguration that ships.
 */

/** A wiring mistake in the HOST's configuration of this surface. */
export class ReportBuilderConfigError extends ReportBuilderError {
  constructor(message: string) {
    super('invalid_config', message);
    this.name = 'ReportBuilderConfigError';
  }
}

function fail(message: string): never {
  throw new ReportBuilderConfigError(message);
}

/** Every catalog entity must state the permission that reaches it. */
function assertEntityPermissions(config: ReportBuilderServerConfig): void {
  const entities = Object.keys(config.catalog.entities);
  if (entities.length === 0) fail('`catalog` declares no entities.');

  const map = config.entityPermission;
  // An EMPTY map is refused rather than treated as "nobody may query anything".
  // Both readings are defensible, which is why the host has to mean one of
  // them: passing `{}` is far more often a config object built from the wrong
  // source than a deliberate lockout.
  if (Object.keys(map).length === 0) {
    fail('`entityPermission` is empty. Name the permission each catalog entity requires.');
  }

  const unmapped = entities.filter(
    (entity) => typeof map[entity] !== 'string' || map[entity]?.trim() === '',
  );
  if (unmapped.length > 0) {
    // Unmapped is fail-CLOSED at request time (nobody reaches the entity), so
    // this is not a security hole — it is a silently missing surface, which is
    // the harder bug to notice: the entity is simply absent from the builder.
    fail(
      `\`entityPermission\` names no permission for ${unmapped
        .map((entity) => `"${entity}"`)
        .join(', ')}. Every catalog entity needs one; an unmapped entity is queryable by nobody.`,
    );
  }
}

/** Built-ins must be runnable: unique keys, a stated tier, a valid spec. */
function assertSystemReports(config: ReportBuilderServerConfig): void {
  const seen = new Set<string>();
  for (const report of config.systemReports) {
    if (report.key.trim() === '') fail('A system report has an empty `key`.');
    if (seen.has(report.key)) fail(`Two system reports share the key "${report.key}".`);
    seen.add(report.key);
    if (report.permission.trim() === '') {
      fail(`System report "${report.key}" states no \`permission\`.`);
    }
    // The spec is compiled against the LIVE catalog here, which is where the
    // deleted `starters.test.ts` / `presets.test.ts` guarantee moves to: a
    // preset naming a field the host's catalog does not have fails at boot,
    // not on the reader's first click.
    try {
      compileReport(reportSpecSchema.parse(report.build({ grain: 'day' })), config.catalog);
    } catch (error) {
      fail(
        `System report "${report.key}" does not compile against this catalog: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** A starter belongs to a catalog entity and must run on it. */
function assertStarters(config: ReportBuilderServerConfig): void {
  for (const [entity, starter] of Object.entries(config.starters ?? {})) {
    if (!config.catalog.entities[entity]) {
      fail(`\`starters\` names "${entity}", which is not an entity of this catalog.`);
    }
    try {
      compileReport(starter, config.catalog);
    } catch (error) {
      fail(
        `Starter for "${entity}" does not compile against this catalog: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * Check a host's wiring, or throw naming the field that is wrong.
 *
 * Called by `createApiReportBuilder`, so every mount — descriptors, Hono
 * router, or a host's own adapter over the descriptors — is covered by the one
 * call.
 */
export function assertReportBuilderConfig(config: ReportBuilderServerConfig): void {
  assertEntityPermissions(config);
  assertSystemReports(config);
  assertStarters(config);

  if (!isValidTimeZone(config.timeZone)) {
    fail(
      `\`timeZone\` is not an IANA zone this runtime knows: "${config.timeZone}". ` +
        'It is required because the report window and the date buckets have to be ' +
        "resolved on the SAME clock, and only the host knows its tenants'.",
    );
  }

  const manage = config.gatePermissions?.manage;
  if (manage !== undefined && manage.trim() === '') {
    fail('`gatePermissions.manage` is empty. Name the permission, or omit the field.');
  }
}
