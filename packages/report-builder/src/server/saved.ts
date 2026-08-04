/**
 * SavedReport store (FUT-138), owned by the package over the model it owns
 * (`prisma/report-builder.prisma`) — duck-typed over the host's client like
 * the adapter. Every function is `clientId`-first and scoped in the `where`:
 * a foreign id is a 0-row no-op, never a leak.
 */

export interface SavedReportRecord {
  id: string;
  name: string;
  description: string | null;
  spec: unknown;
  /** Lifecycle (FUT-307): 'draft' | 'published' (DB CHECK enforced). */
  status: string;
  /** Sharing (FUT-307): 'tenant' | 'roles' | 'private' (DB CHECK enforced). */
  visibility: string;
  /** JSON array of host role ids granted access when visibility = 'roles'. */
  visibilityRoles: unknown;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedReportInput {
  name: string;
  description?: string | null;
  spec: unknown;
  status: string;
  visibility: string;
  visibilityRoles: string[];
}

const summarySelect = {
  id: true,
  name: true,
  description: true,
  spec: true,
  status: true,
  visibility: true,
  visibilityRoles: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface SavedReportWhere {
  id?: string;
  clientId: string;
}

/** The host client delegate this store writes — structural, never generated. */
export interface SavedReportDb {
  savedReport: {
    findMany(args: {
      where: SavedReportWhere;
      select: typeof summarySelect;
      orderBy: { name: 'asc' };
    }): Promise<SavedReportRecord[]>;
    findFirst(args: {
      where: SavedReportWhere;
      select: typeof summarySelect;
    }): Promise<SavedReportRecord | null>;
    create(args: {
      data: {
        clientId: string;
        name: string;
        description: string | null;
        spec: object;
        status: string;
        visibility: string;
        visibilityRoles: string[];
        createdBy: string | null;
      };
      select: typeof summarySelect;
    }): Promise<SavedReportRecord>;
    updateMany(args: {
      where: SavedReportWhere;
      data: {
        name: string;
        description: string | null;
        spec: object;
        status: string;
        visibility: string;
        visibilityRoles: string[];
      };
    }): Promise<{ count: number }>;
    deleteMany(args: { where: SavedReportWhere }): Promise<{ count: number }>;
  };
}

export type SavedReportDbProvider = () => Promise<SavedReportDb>;

/** Whether an error is Prisma's unique-constraint violation (P2002). */
export function isUniqueNameViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

export interface SavedReportStore {
  list(clientId: string): Promise<SavedReportRecord[]>;
  get(clientId: string, id: string): Promise<SavedReportRecord | null>;
  create(clientId: string, input: SavedReportInput, createdBy: string | null): Promise<SavedReportRecord>;
  /** Null when the id is not in this tenant (0 rows matched). */
  update(clientId: string, id: string, input: SavedReportInput): Promise<SavedReportRecord | null>;
  /** False when the id is not in this tenant. */
  remove(clientId: string, id: string): Promise<boolean>;
}

export function createSavedReportStore(getDb: SavedReportDbProvider): SavedReportStore {
  return {
    async list(clientId) {
      const db = await getDb();
      return db.savedReport.findMany({
        where: { clientId },
        select: summarySelect,
        orderBy: { name: 'asc' },
      });
    },
    async get(clientId, id) {
      const db = await getDb();
      return db.savedReport.findFirst({ where: { id, clientId }, select: summarySelect });
    },
    async create(clientId, input, createdBy) {
      const db = await getDb();
      return db.savedReport.create({
        data: {
          clientId,
          name: input.name,
          description: input.description ?? null,
          spec: input.spec as object,
          status: input.status,
          visibility: input.visibility,
          visibilityRoles: input.visibilityRoles,
          createdBy,
        },
        select: summarySelect,
      });
    },
    async update(clientId, id, input) {
      const db = await getDb();
      const { count } = await db.savedReport.updateMany({
        where: { id, clientId },
        data: {
          name: input.name,
          description: input.description ?? null,
          spec: input.spec as object,
          status: input.status,
          visibility: input.visibility,
          visibilityRoles: input.visibilityRoles,
        },
      });
      if (count === 0) return null;
      return db.savedReport.findFirst({ where: { id, clientId }, select: summarySelect });
    },
    async remove(clientId, id) {
      const db = await getDb();
      const { count } = await db.savedReport.deleteMany({ where: { id, clientId } });
      return count > 0;
    },
  };
}
