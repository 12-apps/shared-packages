/**
 * The permission vocabulary this package's OWN surfaces are gated with.
 *
 * A package that ships routes ships the permissions those routes check, and
 * exports them for the host to compose into its catalog beside its own domain
 * ids. The alternative — the package hardcoding a bare string while the host
 * separately declares the same id somewhere else — is one vocabulary in two
 * places with no type link: rename either side and nothing fails to compile.
 *
 * These are RECOMMENDED ids, not enforced ones. `previewPermission` on the
 * server config is a required string, so a host whose catalog spells its
 * permissions differently states its own and never has to adopt this wording;
 * a host with no opinion passes {@link IMPERSONATION_PERMISSIONS.preview} and
 * gets a name that reads the same in every product that installs this package.
 */
export const IMPERSONATION_PERMISSIONS = {
  /**
   * Start a preview session in a tenant.
   *
   * An ORDINARY grantable permission, never an owner marker. An owner-only
   * marker is undelegable by construction, so the administrator who configures a
   * tenant's roles could not check the result and no custom role could be given
   * the job.
   */
  preview: 'user:impersonate',
} as const;

/**
 * The tenant's own CONSENT switch — "may this tenant be viewed as at all" — is
 * deliberately NOT here.
 *
 * This package ships no route that arms it: the switch lives on whatever
 * settings surface the host already has, and it is gated by whatever id that
 * host's catalog uses. A package declares the permissions guarding its OWN
 * screens and endpoints; declaring one for somebody else's screen is how a
 * package ends up shipping an application's catalog.
 */
