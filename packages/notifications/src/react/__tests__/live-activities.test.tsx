// @vitest-environment jsdom
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLINIC_LIVE_MESSAGES, CLINIC_MESSAGES } from '../../__tests__/host-copy';
import type { LiveActivity } from '../../live';

import { createWebNotifications } from '../create-web-notifications';
import type { LiveActivitiesConfig } from '../live-config';
import type { NotificationsResult, NotificationsTransport } from '../transport';

/**
 * LIVE ACTIVITIES through the published surface — `createWebNotifications` and
 * the `Panel` it returns, which is all a host touches.
 *
 * The panel is fetched on demand, so every first assertion after opening it
 * waits for a dynamic import as well as a render. Same budget and same reason
 * as `web-surface.test.tsx`.
 */
configure({ asyncUtilTimeout: 5_000 });

/** Frozen: two assertions here read a relative timestamp. */
const NOW = new Date('2026-08-13T09:10:00.000Z');
const FIVE_MINUTES_EARLIER = '2026-08-13T09:05:00.000Z';

const LANE = [
  { id: 'placed', label: 'Recebido' },
  { id: 'preparing', label: 'Em preparo' },
  { id: 'ready', label: 'Pronto' },
];

function activity(overrides: Partial<LiveActivity> = {}): LiveActivity {
  return {
    id: 'visit-42',
    kind: 'visit',
    title: 'Consulta em andamento',
    body: 'A Nina já está com a veterinária.',
    link: '/consultas/42',
    steps: LANE,
    activeStepId: 'preparing',
    updatedAt: FIVE_MINUTES_EARLIER,
    ...overrides,
  };
}

const EMPTY_INBOX = { items: [], nextCursor: null };

/** Reads only; nothing here writes, and an unstubbed path must still fail loudly. */
function readOnlyTransport(): NotificationsTransport {
  const pages: Record<string, unknown> = {
    '/api/account/notifications/unread-count': { count: 0 },
    '/api/account/notifications?limit=20': EMPTY_INBOX,
  };
  return {
    get<T>(path: string): Promise<T> {
      if (!(path in pages)) return Promise.reject(new Error(`no stub for ${path}`));
      return Promise.resolve(pages[path] as T);
    },
    send<T>(): Promise<NotificationsResult<T>> {
      return Promise.resolve({ ok: true, data: {} as T });
    },
  };
}

/**
 * The host's half: a hook that answers with these activities while anyone is
 * looking, and with nothing when the surface says nobody is.
 *
 * `record` is how the one test that cares observes what it was ASKED — passed
 * in rather than closed over here, so no two tests can ever share the array.
 */
function source(
  activities: readonly LiveActivity[],
  record?: boolean[],
): LiveActivitiesConfig {
  return {
    messages: CLINIC_LIVE_MESSAGES,
    useActivities: ({ active }) => {
      record?.push(active);
      return active ? activities : [];
    },
  };
}

/**
 * The `::after` rule emitted for an element's own classes.
 *
 * Emotion writes its rules into `<style>` tags in the document, and jsdom
 * exposes those through `document.styleSheets` — which is the only way to see a
 * pseudo-element from here. Throws rather than returning empty when it finds
 * nothing, because a helper that silently answers "" makes the assertion above
 * unfailable.
 */
function overlayRuleFor(element: Element): string {
  const classes = [...element.classList];
  const matches: string[] = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      const text = rule.cssText;
      if (text.includes('::after') && classes.some((name) => text.includes(`.${name}`))) {
        matches.push(text);
      }
    }
  }
  if (matches.length === 0) {
    throw new Error(`no ::after rule found for classes ${classes.join(' ')}`);
  }
  return matches.join('\n');
}

function mount(live?: LiveActivitiesConfig): ReturnType<typeof createWebNotifications> {
  return createWebNotifications({
    apiBase: '/api/account',
    messages: CLINIC_MESSAGES,
    transport: readOnlyTransport(),
    ...(live ? { liveActivities: live } : {}),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the live section', () => {
  it('pins the activity above the inbox, with the host heading and the host copy', async () => {
    const config = source([activity()]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activities')).toBeTruthy());
    const section = screen.getByTestId('live-activities');
    expect(section.textContent).toContain(CLINIC_LIVE_MESSAGES.sectionTitle);
    expect(section.textContent).toContain('Consulta em andamento');
    expect(section.textContent).toContain('A Nina já está com a veterinária.');
    // The wording of "5 minutes ago" is the INBOX's, so one panel never carries
    // two vocabularies for the same duration.
    expect(section.textContent).toContain(
      CLINIC_LIVE_MESSAGES.updated(CLINIC_MESSAGES.minutesAgo(5)),
    );

    // ABOVE, not merely present: the whole claim is that what is happening now
    // comes before what already happened.
    const panel = screen.getByTestId('notifications-panel');
    expect(
      section.compareDocumentPosition(screen.getByTestId('notifications-empty')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(panel.contains(section)).toBe(true);
  });

  it('is a NAMED region, so it is not a loose run of controls ahead of the inbox', async () => {
    const config = source([activity()]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} />);

    // The heading is a span rather than a heading element on purpose — an <h2>
    // here would put the inbox's own empty and error states under the live
    // block in the outline. `aria-labelledby` names the region from one either
    // way, and this is the assertion that stops the naming being tidied away.
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: CLINIC_LIVE_MESSAGES.sectionTitle }),
      ).toBeTruthy(),
    );
  });

  it('does not schedule a clock for a section that renders nothing', async () => {
    const config = source([]);
    const { Panel } = mount(config);
    const timers = vi.spyOn(globalThis, 'setInterval');
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('notifications-empty')).toBeTruthy());
    // A tick that cannot change what is on screen is a wasted render, once a
    // minute, for as long as somebody leaves the inbox open.
    expect(
      timers.mock.calls.filter(([, ms]) => ms === 60_000),
    ).toHaveLength(0);
    timers.mockRestore();
  });

  it('makes the WHOLE card the target, not only the half above the lane', async () => {
    // Taking the lane out of the link fixed the markup and left the card
    // looking like one target while only its top half was one.
    const config = source([activity()]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} onNavigate={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activity-open-visit-42')).toBeTruthy());
    // The card has to be the containing block, or the overlay stretches over
    // whatever ancestor happens to be positioned.
    expect(globalThis.getComputedStyle(screen.getByTestId('live-activity-visit-42')).position).toBe(
      'relative',
    );
    // jsdom computes no pseudo-element styles and does no hit-testing, so the
    // overlay is read off the stylesheet it was emitted into. Asserted rather
    // than skipped: this is the whole of what makes the lane clickable, and it
    // is one `sx` key away from being tidied out.
    expect(overlayRuleFor(screen.getByTestId('live-activity-open-visit-42'))).toMatch(
      /position:\s*absolute/,
    );
  });

  it('keeps the sentence audible even though the label replaces the contents', async () => {
    const config = source([activity()]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} onNavigate={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activity-open-visit-42')).toBeTruthy());
    const described = screen
      .getByTestId('live-activity-open-visit-42')
      .getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described ?? '')?.textContent).toBe(
      'A Nina já está com a veterinária.',
    );
  });

  it('draws the lane with the stops BEFORE the active one completed', async () => {
    const config = source([activity()]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activity-steps-visit-42')).toBeTruthy());
    const lane = screen.getByTestId('live-activity-steps-visit-42');
    expect(lane.textContent).toContain('Em preparo');
    // The lane is decoration and says so — four focusable, named controls per
    // entry in front of an inbox would cost a keyboard user the list.
    const decoration = lane.closest('[aria-hidden]');
    expect(decoration).not.toBeNull();
    expect(decoration?.hasAttribute('inert')).toBe(true);
  });

  it('never nests the lane inside the card link — a button in a button is not HTML', async () => {
    // `Stepper` draws every stop as a real <button>, and `clickable={false}`
    // only sets `pointer-events: none`. Wrapping the whole card in a button
    // therefore produced BUTTON > BUTTON: the parser auto-closes the outer one,
    // so a host that server-renders the panel open hydrates against a tree the
    // browser rewrote. `aria-hidden` and `inert` do not fix that; structure does.
    const config = source([activity()]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} onNavigate={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activity-steps-visit-42')).toBeTruthy());
    const card = screen.getByTestId('live-activity-visit-42');
    expect(card.querySelectorAll('button button')).toHaveLength(0);
    // And the lane really is outside the link, not merely un-nested by luck.
    expect(
      screen.getByTestId('live-activity-open-visit-42').contains(
        screen.getByTestId('live-activity-steps-visit-42'),
      ),
    ).toBe(false);
  });

  it('stacks the heading and the sentence, rather than running them together', async () => {
    // `Text` sets no `display`, so two adjacent spans in an ordinary block run
    // together on ONE line with not even a space between them. The inbox row
    // avoids it with a flex column; an earlier draft of this card did not.
    const config = source([activity()]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activity-title-visit-42')).toBeTruthy());
    const title = screen.getByTestId('live-activity-title-visit-42');
    const body = title.parentElement;
    expect(body?.textContent).toContain('A Nina já está com a veterinária.');
    const style = globalThis.getComputedStyle(body as Element);
    expect(style.display).toBe('flex');
    expect(style.flexDirection).toBe('column');
  });

  it('draws the host mark when it renders one, and nothing when it does not', async () => {
    const withIcon: LiveActivitiesConfig = {
      ...source([activity()]),
      renderIcon: (item) => <span data-testid={`mark-${item.kind}`}>◆</span>,
    };
    const { Panel } = mount(withIcon);
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('mark-visit')).toBeTruthy());
    // Decoration beside a heading that already says it — named twice is worse
    // than named once.
    expect(screen.getByTestId('mark-visit').closest('[aria-hidden]')).not.toBeNull();
  });

  it('renders no mark, and no placeholder for one, when the host draws none', async () => {
    const config = source([activity()]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activity-title-visit-42')).toBeTruthy());
    // The tap target holds the mark, so ask IT rather than the whole card —
    // the lane below is `aria-hidden` by design and full of Stepper's own.
    const target = screen.getByTestId('live-activity-title-visit-42').closest('div')
      ?.parentElement;
    // A mark nobody drew must leave nothing behind, not an empty box.
    expect(target?.querySelectorAll('[aria-hidden]') ?? []).toHaveLength(0);
  });

  it('renders no lane when the host says the subject is on a stop the lane lacks', async () => {
    const config = source([activity({ activeStepId: 'discharged' })]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activity-visit-42')).toBeTruthy());
    // A row of dots with none of them lit reads as a process that has stopped.
    await waitFor(() =>
      expect(screen.queryByTestId('live-activity-steps-visit-42')).toBeNull(),
    );
    expect(screen.getByTestId('live-activity-visit-42').textContent).toContain(
      'Consulta em andamento',
    );
  });

  it('renders nothing at all — no heading, no empty state — when nothing is live', async () => {
    const config = source([]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('notifications-empty')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('live-activities')).toBeNull());
    expect(screen.getByTestId('notifications-panel').textContent).not.toContain(
      CLINIC_LIVE_MESSAGES.sectionTitle,
    );
  });

  it('is absent entirely for a host that turned it off', async () => {
    const { Panel } = mount();
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('notifications-empty')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('live-activities')).toBeNull());
  });

  it('never touches the unread count', async () => {
    const config = source([activity()]);
    const { Panel, BellButton } = mount(config);
    render(
      <>
        <BellButton onClick={() => undefined} />
        <Panel open onClose={() => undefined} />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('live-activities')).toBeTruthy());
    // A live entry is not news. Counting it would put a number on the bell that
    // no amount of reading can clear.
    expect(screen.getByTestId('notifications-bell').getAttribute('aria-label')).toBe(
      CLINIC_MESSAGES.openBell,
    );
  });

  it('follows the card link through the host router, closing the panel first', async () => {
    const config = source([activity()]);
    const { Panel } = mount(config);
    const gone: string[] = [];
    const closed: string[] = [];
    render(
      <Panel
        open
        onClose={() => closed.push('closed')}
        onNavigate={(link) => gone.push(link)}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('live-activity-visit-42')).toBeTruthy());
    fireEvent.click(
      screen.getByRole('button', {
        name: CLINIC_LIVE_MESSAGES.openActivity('Consulta em andamento'),
      }),
    );
    expect(gone).toEqual(['/consultas/42']);
    expect(closed).toEqual(['closed']);
  });

  it('renders a linkless activity as plain text rather than a dead button', async () => {
    const config = source([activity({ link: null })]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} onNavigate={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activity-visit-42')).toBeTruthy());
    await waitFor(() =>
      expect(screen.queryByTestId('live-activity-open-visit-42')).toBeNull(),
    );
  });

  it('renders text, not a dead control, in a host with no router', async () => {
    // The panel is specified to mount in a host that has no router at all. A
    // card that follows nothing must not still be a focusable control named
    // "Abrir: …" — that is a promise the panel cannot keep.
    const config = source([activity()]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activity-visit-42')).toBeTruthy());
    await waitFor(() =>
      expect(screen.queryByTestId('live-activity-open-visit-42')).toBeNull(),
    );
    expect(
      screen.queryAllByRole('button', {
        name: CLINIC_LIVE_MESSAGES.openActivity('Consulta em andamento'),
      }),
    ).toHaveLength(0);
  });

  it('tells the host nobody is looking while the panel is shut', async () => {
    const asked: boolean[] = [];
    const config = source([activity()], asked);
    const { Panel } = mount(config);
    const { rerender } = render(<Panel open onClose={() => undefined} />);

    await waitFor(() => expect(screen.getByTestId('live-activities')).toBeTruthy());
    expect(asked).toContain(true);

    rerender(<Panel open={false} onClose={() => undefined} />);
    // The drawer unmounts its content on close, so this is the CLOSING
    // transition: `active` going false is what stops a host-side query firing
    // one last time on the way out.
    await waitFor(() => expect(screen.queryByTestId('live-activities')).toBeNull());
    expect(asked.at(-1)).toBe(false);
  });

  it('re-reads the clock every minute, so the timestamp cannot freeze', async () => {
    const config = source([activity()]);
    const { Panel } = mount(config);
    render(<Panel open onClose={() => undefined} />);

    await waitFor(() =>
      expect(screen.getByTestId('live-activities').textContent).toContain(
        CLINIC_LIVE_MESSAGES.updated(CLINIC_MESSAGES.minutesAgo(5)),
      ),
    );

    // The host's data is unchanged — a react-query poll returns the previous
    // object whenever the response is deep-equal, which within one stage it
    // always is. Nothing but the tick can move this line.
    // Inside `act` because the tick is the CLOCK firing, not the user — the
    // same rule that covers a transport callback.
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    await waitFor(() =>
      expect(screen.getByTestId('live-activities').textContent).toContain(
        CLINIC_LIVE_MESSAGES.updated(CLINIC_MESSAGES.minutesAgo(7)),
      ),
    );
  });
});
