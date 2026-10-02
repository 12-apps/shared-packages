import { useState, type JSX } from 'react';

import { chatManifest } from '@12-apps/chat/manifest';
import { chatWebManifest } from '@12-apps/chat/manifest/web';
import { EN_US_CHAT_UI_COPY, type ChatFetch } from '@12-apps/chat/client';

import { webWiringHost } from '../wiring-web';

/**
 * `@12-apps/chat` — one conversation thread, adopted through the wiring
 * consumer's WEB half and talking to the REAL routes the backend harness
 * mounts (`harness/backend/src/chat-host.ts`) through Vite's `/api` proxy.
 *
 * ## What the host actually supplies
 *
 * Three things, all required, none defaulted:
 *
 * - **a credentialed `fetch`** — the browser's own, same-origin, so the
 *   session cookie rides along. That cookie is the whole of "who am I" as far
 *   as the package is concerned: it never sees a person, only the role the
 *   backend's `authorize` resolves from it;
 * - **the words** — the package's en-US pack, passed by hand;
 * - **how a time reads** — the host's locale and clock conventions.
 *
 * Where the thread sits, and what it is about, is the host's too: the
 * manifest declares no `areas`, because a thread belongs inside whatever
 * screen shows its subject. Here that is the demo request's page, and the
 * endpoint names it.
 *
 * ## The person picker is the session, not a package feature
 *
 * The backend's roster has a requester, a field agent and a two-person
 * support team on each request, plus a stranger who is on none. Picking one
 * writes the cookie the backend reads — the stand-in for signing in as them —
 * and remounts the thread, so one page shows each party's view of the same
 * conversation. The picker's labels are harness scaffolding and stay English.
 */

/** The tenant this harness is. Matches `CHAT_TENANT_ID` in the backend. */
const API_BASE = '/api/admin/harness';

/** The cookie the backend resolves the caller from (`CHAT_PERSON_COOKIE`). */
const PERSON_COOKIE = 'harness_chat_person';

/** The backend roster's people, by the name the picker shows. */
const PEOPLE = [
  { id: 'riley', label: 'Riley (requester)' },
  { id: 'sam', label: 'Sam (field agent)' },
  { id: 'taylor', label: 'Taylor (support team)' },
  { id: 'jordan', label: 'Jordan (support team)' },
  { id: 'casey', label: 'Casey (not a party)' },
] as const;

/** The demo requests a thread can be about. */
const REQUESTS = [
  { id: 'request-open', label: 'Open request' },
  { id: 'request-done', label: 'Finished request' },
] as const;

/** The host's credentialed client — the browser's fetch, cookies included. */
const credentialedFetch: ChatFetch = (url, init) =>
  window.fetch(url, { ...init, credentials: 'same-origin' });

const formatTime = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const { surface } = webWiringHost.adoptWeb({
  manifest: chatManifest,
  web: chatWebManifest,
  bindings: {
    surface: {
      config: { fetch: credentialedFetch, copy: EN_US_CHAT_UI_COPY, formatTime },
    },
  },
});

const { ChatThread } = surface as {
  ChatThread: (props: {
    endpoint: string;
    onUnreadChange?: (unread: number) => void;
    testID?: string;
  }) => JSX.Element;
};

/** Sign in as `person`, as far as the backend's session lookup can tell. */
function signInAs(person: string): string {
  document.cookie = `${PERSON_COOKIE}=${encodeURIComponent(person)}; path=/; SameSite=Lax`;
  return person;
}

export function ChatThreadPage(): JSX.Element {
  // The lazy initializer writes the cookie BEFORE the thread first mounts, so
  // its first load already carries a session.
  const [person, setPerson] = useState<string>(() => signInAs(PEOPLE[0].id));
  const [requestId, setRequestId] = useState<string>(REQUESTS[0].id);
  const [unread, setUnread] = useState(0);

  return (
    <div data-testid="page-chat-thread">
      <h1>Conversation</h1>
      <p>
        Signed in as{' '}
        {PEOPLE.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`chat-as-${entry.id}`}
            aria-pressed={entry.id === person}
            onClick={() => setPerson(signInAs(entry.id))}
          >
            {entry.label}
          </button>
        ))}
      </p>
      <p>
        About{' '}
        {REQUESTS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`chat-request-${entry.id}`}
            aria-pressed={entry.id === requestId}
            onClick={() => setRequestId(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </p>
      <p data-testid="chat-unread">{`Unread: ${unread}`}</p>
      {/* Keyed by person as well as endpoint: the cookie changed, so the
          thread must load again as somebody else. */}
      <ChatThread
        key={`${person}:${requestId}`}
        endpoint={`${API_BASE}/requests/${requestId}/chat`}
        onUnreadChange={setUnread}
      />
    </div>
  );
}
