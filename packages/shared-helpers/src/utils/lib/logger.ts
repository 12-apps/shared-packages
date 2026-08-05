import * as util from 'util';
import * as winston from 'winston';

import { sentryTransport } from './sentry';

// Re-exported through the module the barrel already publishes, so callers reach
// them without importing `./sentry` directly — which stays private for the
// reason its own note gives (the transport is the only way to turn reporting on).
//
// `flushReporter`: for a caller about to `process.exit`.
// `scrub`: for a caller that must fold a CONTEXT OBJECT into a log message. The
// alternative — passing the object as a second argument — has Winston
// `util.inspect` it, which is exactly how a credential or a buyer's details
// reach a third party.
export { flushReporter, scrub } from './sentry';

const isDevelopment = () => process.env['NODE_ENV'] === 'development';

const getDateTime = (date: Date) => date.toISOString().replace('T', ' ').substring(0, 19);

const splatSymbol = Symbol.for('splat');

/** The error reporter, as zero or one transport — built ONCE, not per read. */
const reporterTransports = (): winston.transport[] => {
  const reporter = sentryTransport();
  return reporter ? [reporter] : [];
};
export type ILogger = winston.Logger;
export const logger: ILogger = winston.createLogger({
  level: process.env['LOG_LEVEL'] || 'silly',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.printf(({ level, message, feature, [splatSymbol]: splatArgs = [] }) => {
      const isProd = !isDevelopment();
      const timestamp = getDateTime(new Date());
      const formattedMessage = [timestamp, message, ...(Array.isArray(splatArgs) ? splatArgs : [])].map((value) => {
        try {
          if (typeof value === 'object' || Array.isArray(value) || typeof value === 'function') {
            return util.inspect(value, {
              depth: 5,
              showHidden: false,
              showProxy: false,
              maxArrayLength: null,
              compact: isProd,
            });
          }
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
          }
          if (typeof value === 'symbol' || typeof value === 'bigint') {
            return value.toString();
          }
          return String(value);
        } catch (error) {
          // The one place the console is the ONLY option (FUT-724): this runs
          // INSIDE the Winston formatter, so logging through the logger would
          // re-enter the formatter that is currently failing.
          // eslint-disable-next-line no-console
          console.error(`Error formatting value: ${error}`);
          return value;
        }
      }).join(' ');

      const prefix = feature ? `${level} [${feature}]` : level;
      return `${prefix} ${formattedMessage}`;
    }),
  ),
  // Console always; Sentry only when a DSN is configured (see `./sentry`), so
  // dev, CI and tests stay entirely offline and a production failure stops
  // being readable only over SSH.
  transports: [new winston.transports.Console(), ...reporterTransports()],
});

 export const createFeatureLogger = (featureName: string, enabled: boolean = true): ILogger => logger.child({ feature: featureName, silent: !enabled });
