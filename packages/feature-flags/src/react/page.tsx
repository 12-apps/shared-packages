/**
 * The management screen: pick a flag, see its testers, add one by email,
 * toggle or revoke. Plain React on purpose — no query cache, no router, no
 * UI-kit dependency: the host styles the `ff-*` class hooks with its own
 * system, and the data is a beta cohort, small enough that "refetch after
 * every write" IS the cache policy.
 */

import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";

import type { FlagSummary, GrantView, OrphanGrantSummary } from "../index";
import type { FeatureFlagsApiClient, GrantsPage } from "./api";
import { formatCopy, type FeatureFlagsCopy } from "./copy";

interface PageProps {
  api: FeatureFlagsApiClient;
  copy: FeatureFlagsCopy;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

function FlagList(props: {
  copy: FeatureFlagsCopy;
  flags: readonly FlagSummary[];
  selected: string | null;
  onSelect: (key: string) => void;
}): JSX.Element {
  if (props.flags.length === 0) {
    return <p data-testid="ff-flags-empty">{props.copy.flagsEmpty}</p>;
  }
  return (
    <ul className="ff-flag-list" data-testid="ff-flag-list">
      {props.flags.map((flag) => (
        <li key={flag.key}>
          <button
            type="button"
            className={flag.key === props.selected ? "ff-flag ff-flag--selected" : "ff-flag"}
            data-testid={`ff-flag-${flag.key}`}
            aria-pressed={flag.key === props.selected}
            onClick={() => props.onSelect(flag.key)}
          >
            <span className="ff-flag__label">{flag.label}</span>
            <code className="ff-flag__key">{flag.key}</code>
            <span className="ff-flag__tally">
              {formatCopy(props.copy.tally, { enabled: flag.enabledCount, total: flag.grantCount })}
            </span>
            {flag.description === null ? null : (
              <span className="ff-flag__description">{flag.description}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Orphans(props: {
  copy: FeatureFlagsCopy;
  orphans: readonly OrphanGrantSummary[];
}): JSX.Element | null {
  if (props.orphans.length === 0) return null;
  return (
    <section className="ff-orphans" data-testid="ff-orphans">
      <h3>{props.copy.orphansTitle}</h3>
      <p>{props.copy.orphansHint}</p>
      <ul>
        {props.orphans.map((orphan) => (
          <li key={orphan.flagKey}>
            <code>{orphan.flagKey}</code> — {orphan.grantCount}
          </li>
        ))}
      </ul>
    </section>
  );
}

function GrantRow(props: {
  copy: FeatureFlagsCopy;
  grant: GrantView;
  busy: boolean;
  onToggle: (grant: GrantView) => void;
  onRevoke: (grant: GrantView) => void;
}): JSX.Element {
  const { copy, grant } = props;
  return (
    <tr data-testid={`ff-grant-${grant.userId}`}>
      <td>
        <span className="ff-grant__email">{grant.email ?? grant.userId}</span>
        {grant.name === null ? null : <span className="ff-grant__name"> {grant.name}</span>}
        <span className="ff-grant__granted-by">
          {" "}
          {copy.grantedByPrefix} {grant.grantedBy}
        </span>
      </td>
      <td>{grant.note ?? ""}</td>
      <td>{grant.enabled ? copy.statusOn : copy.statusOff}</td>
      <td>
        <button
          type="button"
          data-testid={`ff-toggle-${grant.userId}`}
          disabled={props.busy}
          onClick={() => props.onToggle(grant)}
        >
          {grant.enabled ? copy.disable : copy.enable}
        </button>
        <button
          type="button"
          data-testid={`ff-revoke-${grant.userId}`}
          disabled={props.busy}
          onClick={() => props.onRevoke(grant)}
        >
          {copy.revoke}
        </button>
      </td>
    </tr>
  );
}

function AddGrantForm(props: {
  copy: FeatureFlagsCopy;
  busy: boolean;
  onAdd: (email: string, note: string) => void;
}): JSX.Element {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    props.onAdd(email, note);
    setEmail("");
    setNote("");
  };
  return (
    <form className="ff-add" onSubmit={submit}>
      <label>
        {props.copy.addEmailLabel}
        <input
          type="email"
          required
          value={email}
          data-testid="ff-add-email"
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        {props.copy.addNoteLabel}
        <input
          type="text"
          value={note}
          data-testid="ff-add-note"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <button type="submit" data-testid="ff-add-submit" disabled={props.busy}>
        {props.busy ? props.copy.adding : props.copy.addSubmit}
      </button>
    </form>
  );
}

interface FlagsState {
  flags: readonly FlagSummary[] | null;
  orphans: readonly OrphanGrantSummary[];
  selected: string | null;
  page: number;
  grants: GrantsPage | null;
  error: string | null;
  busy: boolean;
  select: (key: string) => void;
  setPage: (update: (current: number) => number) => void;
  run: (work: () => Promise<unknown>) => void;
}

function useFlagsState(api: FeatureFlagsApiClient, copy: FeatureFlagsCopy): FlagsState {
  const [flags, setFlags] = useState<readonly FlagSummary[] | null>(null);
  const [orphans, setOrphans] = useState<readonly OrphanGrantSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [grants, setGrants] = useState<GrantsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Writes bump this so both effects refetch — the whole cache policy.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .listFlags()
      .then((result) => {
        if (cancelled) return;
        setFlags(result.flags);
        setOrphans(result.orphans);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause, copy.loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [api, copy.loadError, version]);

  useEffect(() => {
    if (selected === null) return undefined;
    let cancelled = false;
    setGrants(null);
    api
      .listGrants(selected, page)
      .then((result) => {
        if (!cancelled) setGrants(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause, copy.loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [api, copy.loadError, selected, page, version]);

  const run = useCallback(
    (work: () => Promise<unknown>): void => {
      setBusy(true);
      setError(null);
      work()
        .then(() => setVersion((current) => current + 1))
        .catch((cause: unknown) => setError(messageOf(cause, copy.loadError)))
        .finally(() => setBusy(false));
    },
    [copy.loadError],
  );

  const select = useCallback((key: string): void => {
    setSelected(key);
    setPage(1);
    setError(null);
  }, []);

  return { flags, orphans, selected, page, grants, error, busy, select, setPage, run };
}

function GrantsTable(props: {
  copy: FeatureFlagsCopy;
  grants: GrantsPage;
  busy: boolean;
  onToggle: (grant: GrantView) => void;
  onRevoke: (grant: GrantView) => void;
}): JSX.Element {
  if (props.grants.items.length === 0) {
    return <p data-testid="ff-grants-empty">{props.copy.grantsEmpty}</p>;
  }
  return (
    <table className="ff-grants-table">
      <thead>
        <tr>
          <th>{props.copy.thUser}</th>
          <th>{props.copy.thNote}</th>
          <th>{props.copy.thStatus}</th>
          <th>{props.copy.thActions}</th>
        </tr>
      </thead>
      <tbody>
        {props.grants.items.map((grant) => (
          <GrantRow
            key={grant.userId}
            copy={props.copy}
            grant={grant}
            busy={props.busy}
            onToggle={props.onToggle}
            onRevoke={props.onRevoke}
          />
        ))}
      </tbody>
    </table>
  );
}

function Paginator(props: { copy: FeatureFlagsCopy; state: FlagsState }): JSX.Element | null {
  const { copy, state } = props;
  if (state.grants === null) return null;
  const pages = Math.max(1, Math.ceil(state.grants.total / state.grants.perPage));
  return (
    <nav className="ff-paginator" aria-label={copy.pageOf}>
      <button
        type="button"
        data-testid="ff-prev"
        disabled={state.page <= 1 || state.busy}
        onClick={() => state.setPage((current) => Math.max(1, current - 1))}
      >
        {copy.prev}
      </button>
      <span data-testid="ff-page-of">
        {formatCopy(copy.pageOf, { page: state.page, pages, total: state.grants.total })}
      </span>
      <button
        type="button"
        data-testid="ff-next"
        disabled={state.page >= pages || state.busy}
        onClick={() => state.setPage((current) => current + 1)}
      >
        {copy.next}
      </button>
    </nav>
  );
}

function GrantsSection(props: {
  api: FeatureFlagsApiClient;
  copy: FeatureFlagsCopy;
  state: FlagsState;
  selected: string;
}): JSX.Element {
  const { api, copy, state, selected } = props;
  return (
    <section className="ff-grants" data-testid="ff-grants">
      <AddGrantForm
        copy={copy}
        busy={state.busy}
        onAdd={(email, note) =>
          state.run(() =>
            api.grantByEmail(selected, note.trim() === "" ? { email } : { email, note }),
          )
        }
      />
      {state.grants === null ? null : (
        <GrantsTable
          copy={copy}
          grants={state.grants}
          busy={state.busy}
          onToggle={(row) =>
            state.run(() => api.setGrant(selected, row.userId, { enabled: !row.enabled }))
          }
          onRevoke={(row) => state.run(() => api.revoke(selected, row.userId))}
        />
      )}
      <Paginator copy={copy} state={state} />
    </section>
  );
}

export function FeatureFlagsPage(props: PageProps): JSX.Element {
  const { api, copy } = props;
  const state = useFlagsState(api, copy);
  return (
    <div className="ff-page">
      <header className="ff-header">
        <h2>{copy.title}</h2>
        <p>{copy.subtitle}</p>
      </header>
      {state.error === null ? null : (
        <p role="alert" className="ff-error" data-testid="ff-error">
          {state.error}
        </p>
      )}
      {state.flags === null ? null : (
        <FlagList copy={copy} flags={state.flags} selected={state.selected} onSelect={state.select} />
      )}
      {state.selected === null ? (
        <p data-testid="ff-select-prompt">{copy.selectPrompt}</p>
      ) : (
        <GrantsSection api={api} copy={copy} state={state} selected={state.selected} />
      )}
      <Orphans copy={copy} orphans={state.orphans} />
    </div>
  );
}
