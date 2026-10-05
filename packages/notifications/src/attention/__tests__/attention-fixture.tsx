/**
 * The attention host's test world, shared by every suite that mounts it: a
 * registry, the views per kind, the copy, and item builders. The copy is a
 * made-up clinic's, so nothing in a suite leans on any adopter's words.
 */
import { attentionKind, defineAttention, type AttentionItem } from '../core';
import { attentionView, type AttentionMessages } from '../react';

const MIN = 60_000;
export const NOW = Date.parse('2026-10-02T20:00:00.000Z');
const ago = (minutes: number): number => NOW - minutes * MIN;

interface RoomItem extends AttentionItem {
  readonly room: string;
}

export const registry = defineAttention({
  categories: ['ward', 'lab'],
  kinds: [
    attentionKind<RoomItem>({
      id: 'bell',
      category: 'ward',
      budgetMs: 5 * MIN,
    }),
    attentionKind<RoomItem>({
      id: 'sample',
      category: 'lab',
      budgetMs: 10 * MIN,
      permission: 'lab:read',
    }),
  ],
});

export const MESSAGES: AttentionMessages = {
  waited: (minutes) => `${minutes} min`,
  button: ({ title, what, waited, others }) =>
    `Next: ${title}, ${what}, ${waited}${others ? `; ${others} more` : ''}`,
  others: (count, worst) => `See ${count} more, the worst ${worst}`,
  severity: { calm: 'on time', late: 'late', spent: 'very late' },
  othersTitle: 'Also waiting',
  preferences: {
    quickLabel: 'Alert settings',
    sound: {
      title: 'Sound of the alerts',
      shortTitle: 'Sound',
      description: 'Plays when something new waits.',
      levels: { off: 'Off', late: 'Urgent only', all: 'Everything' },
      hints: {
        off: 'Only the button says it',
        late: 'An alert when it turns late',
        all: 'A soft chime for the rest',
      },
      test: 'Play a test',
    },
    vibration: {
      title: 'Vibration of the alerts',
      shortTitle: 'Vibration',
      description: 'Shakes the phone when something new waits.',
      levels: { off: 'Off', late: 'Urgent only', all: 'Everything' },
      hints: { off: 'Never shakes', late: 'A long buzz when it turns late', all: 'A short one for the rest' },
      test: 'Vibrate a test',
      unavailable: 'This device cannot vibrate from a web page.',
      unavailableShort: 'No vibration here.',
    },
    push: {
      title: 'Notifications',
      shortTitle: 'Notifications',
      description: 'Arrives even with the screen locked.',
      levels: { off: 'Off', late: 'Urgent only', all: 'Everything' },
      hints: { off: 'None', late: 'When it turns late', all: 'Everything the button holds' },
      enable: 'Allow notifications',
      test: 'Send a test',
      unavailable: 'Not available on this device.',
    },
    position: {
      title: 'Button position',
      moved: 'You moved the button.',
      resting: 'In the corner.',
      reset: 'Back to the corner',
    },
  },
};

export const openSheets: string[] = [];

export const views = {
  bell: attentionView<RoomItem>({
    icon: <svg data-testid="icon-bell" />,
    describe: (item) => ({ title: `Room ${item.room}`, what: 'Rang the bell' }),
    renderSheet: ({ item, close }) => (
      <div role="dialog" aria-label={`Room ${item.room}`}>
        <button type="button" onClick={close}>
          close
        </button>
      </div>
    ),
  }),
  sample: attentionView<RoomItem>({
    icon: <svg data-testid="icon-sample" />,
    describe: (item) => ({ title: `Room ${item.room}`, what: 'Sample ready' }),
    onOpen: (item) => openSheets.push(item.id),
  }),
};

export const bell = (id: string, minutes: number): RoomItem => ({
  id,
  kind: 'bell',
  since: ago(minutes),
  room: id,
});
export const sample = (id: string, minutes: number): RoomItem => ({
  id,
  kind: 'sample',
  since: ago(minutes),
  room: id,
});
