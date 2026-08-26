import { matchLocale, type Locale } from '../core/locale';

/**
 * Where a reader's chosen language is kept, and the Prisma-backed store that
 * keeps it.
 *
 * ## Why this package stores anything at all
 *
 * Everything else here is mechanism: a canonical list, a pack, a precedence
 * order. This is the one FACT the mechanism needs and could never obtain — and
 * the gap was invisible for exactly as long as every host had a single
 * audience.
 *
 * A screen does not need it. The reader is present, the browser remembers their
 * choice, and the cookie rides along on every request they make. What has no
 * browser in the room is everything written TO them: a notification, stored as
 * rendered TEXT by whichever request or job caused it and read later by
 * somebody who was never in that request; a mail, sent by a background job.
 * Both ask for the recipient's language at the moment they render, and before
 * this there was nothing to ask.
 *
 * ## The duck-typed client, and why there is no import of Prisma
 *
 * {@link LocaleDb} declares the two delegate methods this package calls and
 * nothing else, so a host asserts its own generated client against it at the
 * bind. That is the same seam `@12-apps/auth` uses for `AuthDb`: importing a
 * generated client would tie this package to one schema, one generator version
 * and one database.
 */

/** One row, as this package reads it. */
interface LocalePreferenceRow {
  locale: string;
}

/** The delegate this package calls, and the whole of what a host must supply. */
export interface LocaleDb {
  localePreference: {
    findUnique(args: {
      where: { userId: string };
      select?: { locale: true };
    }): Promise<LocalePreferenceRow | null>;
    upsert(args: {
      where: { userId: string };
      update: { locale: string };
      create: { userId: string; locale: string };
    }): Promise<unknown>;
    deleteMany(args: { where: { userId: string } }): Promise<unknown>;
  };
}

/** How this package reaches the client carrying its model. */
export type LocaleDbProvider = () => Promise<LocaleDb>;

/**
 * Read and write one person's language.
 *
 * `null` is a VALUE on both sides and never an omission: reading it means "this
 * person has not chosen", and writing it means "forget my choice". Both are
 * states a caller must be able to express — without the second, a reader's
 * first ever choice is permanent, and the only way back to the store's own
 * language is a DBA.
 */
export interface LocaleStore {
  read(userId: string): Promise<Locale | null>;
  write(userId: string, locale: Locale | null): Promise<Locale | null>;
}

export interface PrismaLocaleStoreConfig {
  getDb: LocaleDbProvider;
}

export function createPrismaLocaleStore(config: PrismaLocaleStoreConfig): LocaleStore {
  const { getDb } = config;

  return {
    async read(userId) {
      const db = await getDb();
      const row = await db.localePreference.findUnique({
        where: { userId },
        select: { locale: true },
      });
      // Through `matchLocale` on the way OUT as well as in. A tag written by an
      // older release, or by a hand-run SQL fix, must not become the one value
      // in the system that never passed validation — every reader downstream
      // assumes it did.
      return matchLocale(row?.locale) ?? null;
    },

    async write(userId, locale) {
      const db = await getDb();
      if (locale === null) {
        // DELETE rather than write a default. Absence is how "has not chosen"
        // is stored, so clearing has to restore absence; a row holding the
        // default would keep outranking the tenant's language forever.
        await db.localePreference.deleteMany({ where: { userId } });
        return null;
      }
      const next = matchLocale(locale);
      if (next === null) {
        // Re-validated here and not only at the route: the wire is not a
        // boundary a database write should trust, and this store is callable
        // directly by a host's own code.
        throw new Error(`Unsupported locale: ${locale}`);
      }
      // `matchLocale` also NORMALISES ("pt-br" and "PT" both land on "pt-BR"),
      // so the column holds one spelling per language and nothing downstream
      // has to case-fold.
      await db.localePreference.upsert({
        where: { userId },
        update: { locale: next },
        create: { userId, locale: next },
      });
      return next;
    },
  };
}
