import { UnknownNotificationTypeError } from './errors';
import type { NotificationGenerator } from './types';

/**
 * Generator registry: one {@link NotificationGenerator} per event `type`.
 *
 * INSTANCE state, not a module-level Map. the origin's own was
 * process-wide, which is what a package of loose functions forces; a factory
 * config does not need it, and one registry per mount is what makes a test (or
 * a second mount) able to hold its own set without clearing anyone else's.
 * Domain modules still register from the OUTSIDE — that is the open/closed
 * seam the whole pipeline is built on — either through the server config's
 * `generators` array or through `registerGenerator` for a late arrival.
 */
export interface NotificationGeneratorRegistry {
  /** Register (last-wins, so a re-import is idempotent). */
  register<TPayload>(generator: NotificationGenerator<TPayload>): void;
  /** Resolve for `type`, throwing {@link UnknownNotificationTypeError}. */
  resolve(type: string): NotificationGenerator<never>;
  /** Whether a generator is registered for `type` (emit-site guard). */
  has(type: string): boolean;
  /** Every registered type, for diagnostics. */
  types(): string[];
}

export function createGeneratorRegistry(
  initial: readonly NotificationGenerator<never>[] = [],
): NotificationGeneratorRegistry {
  const generators = new Map<string, NotificationGenerator<never>>();
  const registry: NotificationGeneratorRegistry = {
    register(generator) {
      generators.set(generator.type, generator as NotificationGenerator<never>);
    },
    resolve(type) {
      const generator = generators.get(type);
      if (!generator) throw new UnknownNotificationTypeError(type);
      return generator;
    },
    has: (type) => generators.has(type),
    types: () => [...generators.keys()],
  };
  for (const generator of initial) registry.register(generator);
  return registry;
}
