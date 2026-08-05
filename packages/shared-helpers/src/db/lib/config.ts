import type { DatabaseConfig, DatabaseConfigPreset } from './types';

/**
 * What a connection URL can actually supply. Narrower than `Partial<DatabaseConfig>`,
 * whose `password` inherits pg's `string | (() => string | Promise<string>)` union —
 * a URL only ever yields the string form.
 */
interface UrlConfig {
  user?: string;
  password?: string;
  host?: string;
  port?: number;
  database?: string;
}

function parseConnectionUrl(url?: string): UrlConfig | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return {
      user: parsed.username || undefined,
      password: parsed.password || undefined,
      host: parsed.hostname || undefined,
      port: parsed.port ? parseInt(parsed.port) : undefined,
      database: parsed.pathname.slice(1) || undefined, // Remove leading '/'
    };
  } catch {
    return null;
  }
}

interface PresetSpec {
  /** Env-var infix unique to this database, e.g. `AS_DASHBOARD` for `DATABASE_AS_DASHBOARD_HOST`. */
  infix: string;
  /** Connection URL consulted when the individual variables are unset. */
  urlVar: string;
  name: DatabaseConfigPreset;
}

/** First value that is set and non-empty; `undefined` when none of them are. */
const firstSet = (...values: (string | undefined)[]): string | undefined =>
  values.find(Boolean);

// Every field resolves the same way — the database-specific variable, then the
// variable shared by all databases, then whatever the connection URL carried,
// then a literal default. The two presets differ only in the infix and the URL
// variable, so they share one builder.
const buildConfig =
  (spec: PresetSpec) =>
  (env: NodeJS.ProcessEnv): DatabaseConfig => {
    const url = parseConnectionUrl(env[spec.urlVar]) ?? {};
    const own = (suffix: string) => env[`DATABASE_${spec.infix}_${suffix}`];

    return {
      user: firstSet(own('MASTER_USER_NAME'), env.DATABASE_MASTER_USER_NAME, url.user),
      password: firstSet(own('MASTER_PASSWORD'), env.DATABASE_MASTER_PASSWORD, url.password),
      host: firstSet(own('HOST'), env.DATABASE_HOST, url.host),
      port: parseInt(
        firstSet(own('PORT'), env.DATABASE_PORT, url.port ? String(url.port) : undefined) ?? '5432',
      ),
      database: firstSet(own('NAME'), env.DATABASE_NAME, url.database) ?? spec.name,
      name: spec.name,
    };
  };

const CONFIG_PRESETS: Record<DatabaseConfigPreset, (env: NodeJS.ProcessEnv) => DatabaseConfig> = {
  'as': buildConfig({ infix: 'AS_DASHBOARD', urlVar: 'DATABASE_URL_DASHBOARD', name: 'as' }),
  'status-site': buildConfig({ infix: 'STATUS_SITE', urlVar: 'DATABASE_URL_STATUS', name: 'status-site' }),
};

export function getConfigFromPreset(preset: DatabaseConfigPreset, env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const configBuilder = CONFIG_PRESETS[preset];
  if (!configBuilder) {
    throw new Error(`Unknown database config preset: ${preset}`);
  }
  return configBuilder(env);
}

class ConfigError extends Error {
  public config: DatabaseConfig;

  constructor(message: string, config: DatabaseConfig) {
    super(message);
    this.name = 'ConfigError';
    this.config = config;
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}

export function validateConfig(config: DatabaseConfig): void {
  const required = ['user', 'password', 'host', 'database'];
  const missing = required.filter(key => !config[key as keyof DatabaseConfig]);

  if (missing.length > 0) {
    const configDetails = {
      name: config.name,
      host: config.host || 'undefined',
      port: config.port || 'undefined',
      database: config.database || 'undefined',
      user: config.user || 'undefined',
      password: config.password ? '***' : 'undefined',
    };
    throw new ConfigError(
      `Database configuration missing required fields: ${missing.join(', ')}. Config: ${JSON.stringify(configDetails)}`,
      config,
    );
  }
}
