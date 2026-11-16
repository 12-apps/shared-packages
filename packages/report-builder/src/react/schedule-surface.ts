/**
 * What a host hands the reports surface so a report can be scheduled by
 * e-mail (FUT-776). The package renders the control and keeps the choice; the
 * host owns everything about people: who they are, and who may be sent what.
 */

/** One person the host offers as a recipient. */
export interface ScheduleRecipient {
  /** The host's user id — what the schedule stores. */
  id: string;
  name: string;
  /** A line under the name, such as the person's role. */
  detail?: string;
  /**
   * Whether this person may receive THIS report — the host computed it from
   * what the report reads. False renders the person disabled, never hidden.
   */
  canReceive: boolean;
  /** Why not, shown in place of `detail` when `canReceive` is false. */
  reason?: string;
  /** Ticked the first time the schedule is switched on (the person saving). */
  preselected?: boolean;
}

export interface ReportScheduleSurface {
  /**
   * The store's people, each judged against the entities the report reads. It
   * is asked again when those entities change.
   */
  recipients(query: { tenantSlug: string; entities: string[] }): Promise<ScheduleRecipient[]>;
  /**
   * Set when the host does not offer the feature to this store (a plan that
   * excludes it): the control renders locked, with this sentence as the
   * reason. The host words it.
   */
  lockedReason?: string;
  /**
   * The whole phrase the dialog calls the store's clock, such as "Horário de
   * São Paulo". Absent: the platform's name for the surface's zone.
   */
  timeZoneLabel?: string;
}
