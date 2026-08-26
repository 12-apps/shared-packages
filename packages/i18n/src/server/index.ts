/**
 * The SERVER half of the locale axis.
 *
 * Two things live behind this subpath, and the split is deliberate:
 *
 * - **`./request`** — what one incoming `Request` is asking for. Framework-free,
 *   stateless, no storage. It has been here since the package shipped.
 * - **`./store`, `./locale-routes`, `./create-api-locale`** — what one PERSON
 *   reads, which is the fact the mechanism could never obtain on its own. A
 *   browser's cookie answers for a screen and answers nothing for a
 *   notification or a mail, because neither has that browser in the room.
 *
 * Behind a subpath so a browser bundle importing `.` or `./react` never
 * resolves any of it.
 */
export {
  localeFromRequest,
  LOCALE_COOKIE,
  LOCALE_QUERY_PARAM,
  type RequestLocaleOptions,
} from './request';

export {
  createPrismaLocaleStore,
  type LocaleDb,
  type LocaleDbProvider,
  type LocaleStore,
  type PrismaLocaleStoreConfig,
} from './store';

export {
  localeRoutes,
  type LocaleRequest,
  type LocaleResponse,
  type LocaleRoute,
  type LocaleRoutesConfig,
} from './locale-routes';

export { createApiLocale } from './create-api-locale';
