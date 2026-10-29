-- @12-apps/rbac: a person's resolved RBAC, one row per person and scope, kept
-- current by marking it stale (`rbac_effective_grants`, ADOPTING.md "Effective
-- grants").
--
-- A row holds what the package's resolver (`loadSubjectGrants`) answered for
-- one person at one scope: the membership's role and whether it is active, the
-- role assignments with their permissions inline, and every resource grant not
-- yet ended, with its window. Reading a person's whole RBAC is then ONE
-- statement, `WHERE user_id = $1`.
--
-- The triggers below do not compute anything. Every write to an RBAC table
-- marks the rows it can affect `stale`, bumps their `version` and calls
-- `pg_notify('rbac_changed', <user id>)`. The package's TypeScript resolver
-- recomputes a stale row on the next read, so the role rule exists once, in
-- the resolver, and never in SQL. A row a trigger marks is INSERTED stale when
-- it does not exist yet, which keeps the table complete: every person and
-- scope any RBAC row could grant at has a row, so a person with no rows holds
-- nothing.
--
-- `version` is what keeps a recompute honest. The reader writes its result
-- back only `WHERE version = <the version it read>`, so a change that commits
-- while it computes leaves the row stale for the next read.
--
-- Additive: a table, functions and triggers. The backfill at the end marks
-- every person and scope that holds anything, so the first read recomputes.
-- A host whose own triggers already notify `rbac_changed` keeps working: the
-- payloads are the same.

CREATE TABLE IF NOT EXISTS "rbac_effective_grants" (
    "user_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "membership_role" TEXT,
    "membership_active" BOOLEAN,
    "assignments" JSONB NOT NULL DEFAULT '[]',
    "resources" JSONB NOT NULL DEFAULT '[]',
    "stale" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3),

    CONSTRAINT "rbac_effective_grants_pkey" PRIMARY KEY ("user_id", "scope")
);

-- A role's change marks every row at its scope.
CREATE INDEX IF NOT EXISTS "rbac_effective_grants_scope_idx" ON "rbac_effective_grants"("scope");

-- Mark one person's row at one scope stale, creating it when it is missing,
-- and tell every listening process. A host marks rows from its own tables'
-- triggers through this function too (ADOPTING.md, "Effective grants").
CREATE OR REPLACE FUNCTION rbac_grants_mark(p_user TEXT, p_scope TEXT) RETURNS VOID AS $$
BEGIN
  IF p_user IS NULL OR p_scope IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO rbac_effective_grants (user_id, scope) VALUES (p_user, p_scope)
  ON CONFLICT (user_id, scope)
  DO UPDATE SET stale = true, version = rbac_effective_grants.version + 1;
  PERFORM pg_notify('rbac_changed', p_user);
END;
$$ LANGUAGE plpgsql;

-- Mark every row at a scope stale. A NULL scope is a template role, which no
-- single tenant owns: then every row is marked and the payload is `*`.
CREATE OR REPLACE FUNCTION rbac_grants_mark_scope(p_scope TEXT) RETURNS VOID AS $$
DECLARE
  marked RECORD;
BEGIN
  IF p_scope IS NULL THEN
    UPDATE rbac_effective_grants SET stale = true, version = version + 1;
    PERFORM pg_notify('rbac_changed', '*');
    RETURN;
  END IF;
  FOR marked IN
    UPDATE rbac_effective_grants SET stale = true, version = version + 1
     WHERE scope = p_scope
    RETURNING user_id
  LOOP
    PERFORM pg_notify('rbac_changed', marked.user_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- memberships and resource_assignments name their person and tenant. An
-- UPDATE that keeps both marks the row once.
CREATE OR REPLACE FUNCTION rbac_grants_stale_by_client() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM rbac_grants_mark(OLD.user_id, OLD.client_id);
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE'
      AND (OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.client_id IS DISTINCT FROM NEW.client_id)) THEN
    PERFORM rbac_grants_mark(NEW.user_id, NEW.client_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- role_assignments name their person and scope (a tenant, GLOBAL or org:<id>).
CREATE OR REPLACE FUNCTION rbac_grants_stale_by_scope() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM rbac_grants_mark(OLD.user_id, OLD.scope);
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE'
      AND (OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.scope IS DISTINCT FROM NEW.scope)) THEN
    PERFORM rbac_grants_mark(NEW.user_id, NEW.scope);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- A membership's role link names the membership; its person is on that row.
-- A link removed by its membership's own deletion finds no membership left,
-- and needs none: the membership's trigger already marked the row.
CREATE OR REPLACE FUNCTION rbac_grants_stale_by_membership() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM rbac_grants_mark(m.user_id, m.client_id) FROM memberships m WHERE m.id = OLD.membership_id;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.membership_id IS DISTINCT FROM NEW.membership_id) THEN
    PERFORM rbac_grants_mark(m.user_id, m.client_id) FROM memberships m WHERE m.id = NEW.membership_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- A role's permissions reach every row at its store.
CREATE OR REPLACE FUNCTION rbac_grants_stale_by_role() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM rbac_grants_mark_scope(OLD.client_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR OLD.client_id IS DISTINCT FROM NEW.client_id) THEN
    PERFORM rbac_grants_mark_scope(NEW.client_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- TRUNCATE fires no row trigger, and "any change" includes it.
CREATE OR REPLACE FUNCTION rbac_grants_stale_everyone() RETURNS TRIGGER AS $$
BEGIN
  UPDATE rbac_effective_grants SET stale = true, version = version + 1;
  PERFORM pg_notify('rbac_changed', '*');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- An UPDATE marks only when a column the resolver reads moved: a membership's
-- `updated_at` or a role's `published_version` alone changes nobody's grants.
DROP TRIGGER IF EXISTS memberships_rbac_grants_stale ON memberships;
CREATE TRIGGER memberships_rbac_grants_stale
  AFTER INSERT OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION rbac_grants_stale_by_client();
DROP TRIGGER IF EXISTS memberships_rbac_grants_stale_update ON memberships;
CREATE TRIGGER memberships_rbac_grants_stale_update
  AFTER UPDATE ON memberships
  FOR EACH ROW
  WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id
     OR OLD.client_id IS DISTINCT FROM NEW.client_id
     OR OLD.role IS DISTINCT FROM NEW.role
     OR OLD.active IS DISTINCT FROM NEW.active)
  EXECUTE FUNCTION rbac_grants_stale_by_client();

DROP TRIGGER IF EXISTS resource_assignments_rbac_grants_stale ON resource_assignments;
CREATE TRIGGER resource_assignments_rbac_grants_stale
  AFTER INSERT OR UPDATE OR DELETE ON resource_assignments
  FOR EACH ROW EXECUTE FUNCTION rbac_grants_stale_by_client();

DROP TRIGGER IF EXISTS role_assignments_rbac_grants_stale ON role_assignments;
CREATE TRIGGER role_assignments_rbac_grants_stale
  AFTER INSERT OR UPDATE OR DELETE ON role_assignments
  FOR EACH ROW EXECUTE FUNCTION rbac_grants_stale_by_scope();

DROP TRIGGER IF EXISTS membership_roles_rbac_grants_stale ON membership_roles;
CREATE TRIGGER membership_roles_rbac_grants_stale
  AFTER INSERT OR UPDATE OR DELETE ON membership_roles
  FOR EACH ROW EXECUTE FUNCTION rbac_grants_stale_by_membership();

DROP TRIGGER IF EXISTS roles_rbac_grants_stale ON roles;
CREATE TRIGGER roles_rbac_grants_stale
  AFTER INSERT OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION rbac_grants_stale_by_role();
DROP TRIGGER IF EXISTS roles_rbac_grants_stale_update ON roles;
CREATE TRIGGER roles_rbac_grants_stale_update
  AFTER UPDATE ON roles
  FOR EACH ROW
  WHEN (OLD.client_id IS DISTINCT FROM NEW.client_id
     OR OLD.name IS DISTINCT FROM NEW.name
     OR OLD.permissions IS DISTINCT FROM NEW.permissions
     OR OLD.archived_at IS DISTINCT FROM NEW.archived_at)
  EXECUTE FUNCTION rbac_grants_stale_by_role();

DROP TRIGGER IF EXISTS memberships_rbac_grants_truncated ON memberships;
CREATE TRIGGER memberships_rbac_grants_truncated AFTER TRUNCATE ON memberships
  FOR EACH STATEMENT EXECUTE FUNCTION rbac_grants_stale_everyone();
DROP TRIGGER IF EXISTS resource_assignments_rbac_grants_truncated ON resource_assignments;
CREATE TRIGGER resource_assignments_rbac_grants_truncated AFTER TRUNCATE ON resource_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION rbac_grants_stale_everyone();
DROP TRIGGER IF EXISTS role_assignments_rbac_grants_truncated ON role_assignments;
CREATE TRIGGER role_assignments_rbac_grants_truncated AFTER TRUNCATE ON role_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION rbac_grants_stale_everyone();
DROP TRIGGER IF EXISTS membership_roles_rbac_grants_truncated ON membership_roles;
CREATE TRIGGER membership_roles_rbac_grants_truncated AFTER TRUNCATE ON membership_roles
  FOR EACH STATEMENT EXECUTE FUNCTION rbac_grants_stale_everyone();
DROP TRIGGER IF EXISTS roles_rbac_grants_truncated ON roles;
CREATE TRIGGER roles_rbac_grants_truncated AFTER TRUNCATE ON roles
  FOR EACH STATEMENT EXECUTE FUNCTION rbac_grants_stale_everyone();

-- The backfill: a stale row for every person and scope that holds anything,
-- so the table is complete from its first read. Ended resource assignments
-- grant nothing and are left out.
INSERT INTO rbac_effective_grants (user_id, scope)
SELECT user_id, client_id FROM memberships
UNION
SELECT user_id, scope FROM role_assignments
UNION
SELECT user_id, client_id FROM resource_assignments
 WHERE valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP
ON CONFLICT (user_id, scope) DO NOTHING;
