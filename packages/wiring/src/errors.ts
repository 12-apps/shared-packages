/**
 * The two failure vocabularies of the wiring contract, split by WHOSE mistake
 * each one names.
 *
 * A `WiringDefinitionError` is the PACKAGE author's: a manifest that declares
 * an empty name, a duplicate operation id, a permission id with no domain
 * segment. It throws from the producer factories, at package build/test time,
 * so a malformed manifest never reaches a host.
 *
 * A `WiringAssemblyError` is the HOST's: a declared capability left neither
 * bound nor declined, two packages claiming one route, a binding for a
 * capability the manifest never declared. It throws from `assemble()`, at host
 * boot/test time — the same moment `assertReportBuilderConfig` fails a bad
 * report catalog, and for the same reason: a wiring mistake must be a red
 * boot, not a quiet 404 in production.
 */

/** A malformed manifest — the package author's error, thrown by the producer. */
export class WiringDefinitionError extends Error {
  readonly packageName: string;

  constructor(packageName: string, message: string) {
    super(`[${packageName}] ${message}`);
    this.name = "WiringDefinitionError";
    this.packageName = packageName;
  }
}

/** A wiring mistake — the host's error, thrown by the consumer. */
export class WiringAssemblyError extends Error {
  readonly hostName: string;

  constructor(hostName: string, message: string) {
    super(`[${hostName}] ${message}`);
    this.name = "WiringAssemblyError";
    this.hostName = hostName;
  }
}
