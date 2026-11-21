/**
 * The host's own controls on an inbox row.
 *
 * A seam in the same style as the live section's `renderIcon` / `renderCard`:
 * the package cannot know what a notification asks of its reader (accept,
 * decline, snooze), and it has no words for it either, so the host draws the
 * controls and the package keeps the row.
 */
import type { ReactNode } from 'react';

import type { InboxNotification } from '../wire';

/**
 * Real controls for one row, or `null`/`undefined` for the row as it is.
 *
 * Called during the row's render, once per row per render, so keep it cheap and
 * free of hooks: return an ELEMENT, and put any hooks in the component it names.
 *
 * **The controls sit BESIDE the row's link, never inside it**, in the tab order
 * right after it, so unlike the live card's `renderCard` they may be
 * interactive: buttons, a menu. A click on one never reaches the link and never
 * opens the notification; the row's seen/read behaviour belongs to the open
 * gesture and an action does not trigger it, so mark the row read yourself if
 * the action should (`store.markRead`).
 *
 * The slot is a flex row that starts from the left and wraps; below the width
 * where children no longer fit side by side each child takes the whole row
 * (a CONTAINER query on the row, never the viewport). Return the controls as
 * direct children of a fragment, or as an array, to get that layout.
 */
export type NotificationActionsRenderer = (notification: InboxNotification) => ReactNode;
