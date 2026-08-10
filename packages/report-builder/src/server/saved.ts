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
  /**
   * The period the report opens on (FUT-755): 'today' | '7d' | '30d', DB CHECK
   * enforced. NULL means "no preference" — the reader resolves it to 30d, the
   * behaviour every row that predates the column already had.
   */
  defaultRange: string | null;
  /**
   * Unpublished changes parked beside the published document (FUT-755), or
   * NULL when there are none. Untrusted JSON exactly like `spec` — read
   * through `readWorkingCopy`, never trusted as a shape.
   *
   * OPTIONAL rather than required, which is a deliberate kindness to adopters:
   * the only thing that ever produces this field is this store's own
   * `summarySelect`, so a host cannot forget it — while a fixture or an
   * in-memory double written against the previous shape would otherwise stop
   * compiling for a field it has no opinion about. Absent reads as "none",
   * which is what a row without a working copy means anyway.
   */
  workingCopy?: unknown;
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
  /** Omitted or null clears the preference back to the reader's default. */
  defaultRange?: string | null;
}

const summarySelect = {
  id: true,
  name: true,
  description: true,
  spec: true,
  status: true,
  visibility: true,
  visibilityRoles: true,
  defaultRange: true,
  workingCopy: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The document fields every full write sets. Factored out because publishing
 * writes exactly these PLUS `workingCopy: null` — one statement, so a publish
 * can never leave the parked edit behind as a phantom "unpublished changes".
 */
function documentData(input: SavedReportInput): {
  name: string;
  description: string | null;
  spec: object;
  status: string;
  visibility: string;
  visibilityRoles: string[];
  defaultRange: string | null;
} {
  return {
    name: input.name,
    description: input.description ?? null,
    spec: input.spec as object,
    status: input.status,
    visibility: input.visibility,
    visibilityRoles: input.visibilityRoles,
    defaultRange: input.defaultRange ?? null,
  };
}

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
        defaultRange: string | null;
        createdBy: string | null;
      };
      select: typeof summarySelect;
    }): Promise<SavedReportRecord>;
    updateMany(args: {
      where: SavedReportWhere;
      data: {
        name?: string;
        description?: string | null;
        spec?: object;
        status?: string;
        visibility?: string;
        visibilityRoles?: string[];
        defaultRange?: string | null;
        /**
         * `null` DROPS the parked edit. Optional so an ordinary update leaves
         * it alone: archiving a report re-sends the document with only
         * `status` changed, and that must not silently destroy unpublished
         * work the author has not seen since.
         */
        workingCopy?: object | null;
      };
    }): Promise<{ count: number }>;
    deleteMany(args: { where: SavedReportWhere }): Promise<{ count: number }>;
  };
}

export type SavedReportDbProvider = () => Promise<SavedReportDb>;

/** One tenant-scoped document write, re-read so the caller gets the new row. */
async function writeDocument(
  getDb: SavedReportDbProvider,
  clientId: string,
  id: string,
  data: Parameters<SavedReportDb['savedReport']['updateMany']>[0]['data'],
): Promise<SavedReportRecord | null> {
  const db = await getDb();
  const { count } = await db.savedReport.updateMany({ where: { id, clientId }, data });
  if (count === 0) return null;
  return db.savedReport.findFirst({ where: { id, clientId }, select: summarySelect });
}

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
  /**
   * Null when the id is not in this tenant (0 rows matched). Leaves any parked
   * working copy untouched — see the `workingCopy` note on the db delegate.
   */
  update(clientId: string, id: string, input: SavedReportInput): Promise<SavedReportRecord | null>;
  /**
   * Make `input` the live document AND drop the parked edit, in one write
   * (FUT-755). Two statements could leave a published report still advertising
   * unpublished changes that are byte-for-byte what it already shows.
   */
  publishWorkingCopy(
    clientId: string,
    id: string,
    input: SavedReportInput,
  ): Promise<SavedReportRecord | null>;
  /** Park the author's in-progress edit; the live document is not written. */
  saveWorkingCopy(clientId: string, id: string, workingCopy: object): Promise<boolean>;
  /** Throw the parked edit away; the live document was never touched. */
  discardWorkingCopy(clientId: string, id: string): Promise<boolean>;
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
          defaultRange: input.defaultRange ?? null,
          createdBy,
        },
        select: summarySelect,
      });
    },
    async update(clientId, id, input) {
      return writeDocument(getDb, clientId, id, documentData(input));
    },
    async publishWorkingCopy(clientId, id, input) {
      return writeDocument(getDb, clientId, id, { ...documentData(input), workingCopy: null });
    },
    async saveWorkingCopy(clientId, id, workingCopy) {
      const db = await getDb();
      const { count } = await db.savedReport.updateMany({
        where: { id, clientId },
        data: { workingCopy },
      });
      return count > 0;
    },
    async discardWorkingCopy(clientId, id) {
      const db = await getDb();
      const { count } = await db.savedReport.updateMany({
        where: { id, clientId },
        data: { workingCopy: null },
      });
      return count > 0;
    },
    async remove(clientId, id) {
      const db = await getDb();
      const { count } = await db.savedReport.deleteMany({ where: { id, clientId } });
      return count > 0;
    },
  };
}
