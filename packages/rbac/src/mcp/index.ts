/**
 * `@12-apps/rbac/mcp` — this package's own admin surface, as MCP tools.
 *
 * The `mcp` capability the manifest declares. A host concatenates the result
 * into its registry and passes it through `mcpEndpoints` at adoption; the
 * contract collects it, checks operation-id uniqueness, and the surface gates
 * take it from there.
 */
export { rbacMcpEndpoints } from './endpoints';
export type { RbacHttpMethod, RbacMcpAnnotations, RbacMcpEndpoint } from './twin';
export type { RbacMcpOperation, RbacMcpVocabulary } from './vocabulary';
export {
  teamContextSchema,
  teamMemberDetailSchema,
  teamMemberSchema,
  roleSchemaOf,
  roleListRowSchemaOf,
  roleWriteBodyOf,
  templateOverrideBodyOf,
  permissionSetOf,
  inviteBody,
  setMemberActiveBody,
  grantMemberRoleBody,
} from './schemas';
