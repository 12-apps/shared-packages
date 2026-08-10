/**
 * The tenant's roles, for the "Cargos específicos" allowlist picker (FUT-307).
 *
 * The one query on this surface that is NOT a reports endpoint: `GET /roles`
 * belongs to the host, answers with its own paginated envelope rather than the
 * `{ data }` one every reports route uses, and is read by exactly one component
 * (`publish-section`'s `RolesAllowlist`). It sat in `custom-reports-api`
 * regardless, which is the module the whole reports client reads through and
 * which sits on the size gate's ceiling — so the hook that has least to do with
 * it is the one that leaves (FUT-755).
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { adminReportsPath } from "../custom-reports-api";
import { useTransport } from "../transport-context";

/** One tenant role, as the publish section's allowlist picker needs it. */
interface TenantRoleOption {
  id: string;
  name: string;
}

/** How many pages to walk before assuming something is wrong. */
const MAX_ROLE_PAGES = 20;

/**
 * The tenant's roles for the `visibility: "roles"` allowlist picker.
 *
 * Reuses `GET /roles` (roles:manage — the same admin tier that may save
 * documents); the picker walks EVERY page so no role is silently unpickable.
 * The page cap is a runaway guard only — 20 × 100 is far beyond any real
 * tenant.
 */
export function useTenantRoles(
  tenantSlug: string,
  enabled: boolean,
): UseQueryResult<TenantRoleOption[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: ["admin", tenantSlug, "roles", "picker"],
    queryFn: async () => {
      const roles: TenantRoleOption[] = [];
      for (let page = 1; page <= MAX_ROLE_PAGES; page += 1) {
        // The roles endpoint answers with a paginated envelope rather than the
        // `{ data }` one every reports endpoint uses, so this asks the
        // transport for the page itself and reads both halves.
        const result = await transport.getRaw<{
          data: TenantRoleOption[];
          pagination: { hasNextPage: boolean };
        }>(adminReportsPath(tenantSlug, `/roles?page=${page}&pageSize=100`));
        roles.push(...result.data.map((role) => ({ id: role.id, name: role.name })));
        if (!result.pagination.hasNextPage) break;
      }
      return roles;
    },
    enabled: enabled && tenantSlug !== "",
  });
}
