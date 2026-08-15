/**
 * Every sentence this package can say to a USER, stated by the HOST.
 *
 * The copy lives in ONE table rather than in each screen so the api half and
 * the react half can never disagree about a sentence — the 401 body the wire
 * returns and the error the panel renders come from the same key.
 *
 * THE pt-BR TABLE THAT USED TO BE THE DEFAULT IS GONE. Its own docstring said
 * what it was: "the product copy the surface shipped with", labelled in the
 * source as one named application's "exact copy". A description of one adopter,
 * shipped inside the package every other adopter installs, and reached by
 * saying nothing.
 *
 * `categoryLabels` is the sharpest of the forty. The categories themselves
 * became required config in the release before this one, precisely because
 * WHICH categories exist is product vocabulary — and their LABELS kept
 * defaulting, so a host that declared `['loans', 'fines']` got a labels map
 * describing somebody else's four. Required categories with defaulted labels
 * for a different host's categories is not a smaller version of the bug; it is
 * the same bug with a compile-time gesture in front of it.
 *
 * So `messages` is REQUIRED and whole. The interface is the checklist, and the
 * compiler names the sentences a host has not written yet.
 */
/**
 * The sentences the SERVER half renders — and the whole of what a backend mount
 * has to state.
 *
 * Split out when `messages` became required. Requiring the full forty on a
 * server config would have made a backend-only adopter write three dozen
 * sentences for screens it does not serve, which is the kind of tax that gets a
 * required-config migration reverted rather than adopted. These four are the
 * ones the router and the route descriptors actually put on a wire.
 */
export interface NotificationWireMessages {
  unauthenticated: string;
  invalidBody: string;
  operationFailed: string;
  /** `POST /notifications/mark-read` with neither `ids` nor `all`. */
  markReadTargetRequired: string;
}

/** Every sentence, wire and screen — what the REACT half needs. */
export interface NotificationMessages extends NotificationWireMessages {
  // --- the inbox panel -----------------------------------------------------
  panelTitle: string;
  markAllRead: string;
  loading: string;
  loadMore: string;
  loadingMore: string;
  loadFailedTitle: string;
  loadFailedBody: string;
  retry: string;
  emptyTitle: string;
  emptyBody: string;
  openBell: string;
  /** `(count) => 'Abrir notificações (3 não lidas)'`. */
  openBellWithUnread: (count: number) => string;
  unreadSuffix: string;
  deleteOne: (title: string) => string;

  // --- relative timestamps -------------------------------------------------
  justNow: string;
  minutesAgo: (minutes: number) => string;
  hoursAgo: (hours: number) => string;
  daysAgo: (days: number) => string;
  /** Locale for the fallback absolute date on rows older than a week. */
  dateLocale: string;

  // --- the preferences screen ---------------------------------------------
  preferencesTitle: string;
  preferencesLead: string;
  channelLabels: Record<string, string>;
  channelUnavailableHints: Record<string, string>;
  categoryLabels: Record<string, { title: string; description: string }>;
  /** Fallback title for a category the host added but did not label. */
  categoryFallbackTitle: (category: string) => string;
  devicePushTitle: string;
  devicePushIdle: string;
  devicePushOn: string;
  devicePushDenied: string;
  devicePushFailed: string;
  devicePushEnable: string;
  devicePushEnabling: string;
}

/**
 * The messages in force.
 *
 * A pass-through rather than a merge: there is nothing left to merge WITH, and
 * that is the point of the change. The old version spread the host's table over
 * the origin's, including PER KEY inside `channelLabels`,
 * `channelUnavailableHints` and `categoryLabels` — so a host that relabelled one
 * channel kept the origin's wording for the other three, and a host that
 * labelled its own two categories kept the origin's four sitting beside them in
 * the same screen.
 *
 * Kept as a function because all three mounts read it off a config object, and
 * because a later rule (a blank-string refusal, say) belongs in one place.
 */
export function messagesOf<T extends NotificationWireMessages>(config: { messages: T }): T {
  return config.messages;
}
