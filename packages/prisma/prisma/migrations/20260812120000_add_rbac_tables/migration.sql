-- @12-apps/rbac (12-13): the five generic RBAC tables, owned by the package
-- and copied into a host's migrations folder by its plugin-migration sync.
-- Deliberately NO foreign keys into host tables (self-contained package
-- schema, the payments-backend doctrine): `user_id` and `client_id` are
-- by-value scalars, and the host's own migration may add FK constraints.
-- Relations INTERNAL to the partial (membership_roles -> memberships/roles)
-- ARE constrained, with cascades, so a removed membership or deleted role can
-- never leave a dangling grant. `role`/`kind` carry no CHECK here: the role
-- catalog is host config, so a closed set would be wrong for every host but
-- the first.

CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "memberships_user_id_client_id_key" ON "memberships"("user_id", "client_id");
CREATE INDEX "memberships_client_id_idx" ON "memberships"("client_id");
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "client_id" TEXT,
    "name" TEXT NOT NULL,
    "permissions" TEXT NOT NULL,
    "description" TEXT,
    "is_template" BOOLEAN NOT NULL DEFAULT true,
    "kind" TEXT NOT NULL DEFAULT 'CUSTOM',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "published_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_client_id_name_key" ON "roles"("client_id", "name");
CREATE INDEX "roles_client_id_idx" ON "roles"("client_id");
CREATE INDEX "roles_client_id_archived_at_idx" ON "roles"("client_id", "archived_at");
-- Postgres treats NULL client_id as distinct in the unique above, so TEMPLATE
-- (platform) role names need their own partial unique index — Prisma cannot
-- express a filtered index, hence raw SQL.
CREATE UNIQUE INDEX "roles_template_name_key" ON "roles"("name") WHERE "client_id" IS NULL;

CREATE TABLE "membership_roles" (
    "id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "membership_roles_membership_id_role_id_key" ON "membership_roles"("membership_id", "role_id");
CREATE INDEX "membership_roles_membership_id_idx" ON "membership_roles"("membership_id");
CREATE INDEX "membership_roles_role_id_idx" ON "membership_roles"("role_id");

ALTER TABLE "membership_roles"
  ADD CONSTRAINT "membership_roles_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_roles"
  ADD CONSTRAINT "membership_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "role_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_assignments_user_id_role_name_scope_key" ON "role_assignments"("user_id", "role_name", "scope");
CREATE INDEX "role_assignments_user_id_idx" ON "role_assignments"("user_id");
CREATE INDEX "role_assignments_scope_idx" ON "role_assignments"("scope");

CREATE TABLE "resource_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMP(3),

    CONSTRAINT "resource_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "resource_assignments_user_id_resource_type_idx" ON "resource_assignments"("user_id", "resource_type") WHERE "valid_to" IS NULL;
CREATE INDEX "resource_assignments_client_id_resource_type_resource_id_idx" ON "resource_assignments"("client_id", "resource_type", "resource_id");

-- At most ONE active assignment per (user, tenant, resource). Two concurrent
-- requests could each INSERT a new active row; a partial UNIQUE index over the
-- ACTIVE rows makes the second concurrent insert fail at the DB rather than
-- relying on a racy app-level check-then-insert. Added while the table is
-- EMPTY (free) -- it is much harder to add later once live data may already
-- contain duplicates. Prisma cannot express a filtered index, hence raw SQL
-- (the same reason as roles_template_name_key above). Revocation stamps
-- valid_to, so historical rows never collide.
CREATE UNIQUE INDEX "resource_assignments_active_unique_idx"
  ON "resource_assignments"("user_id", "client_id", "resource_type", "resource_id")
  WHERE "valid_to" IS NULL;
