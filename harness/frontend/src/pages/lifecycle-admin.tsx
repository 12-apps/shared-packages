import { useCallback, useEffect, useState, type JSX } from 'react';

import { createWebEntityLifecycle } from '@12-apps/entity-lifecycle/react';
import type { DraftWire } from '@12-apps/entity-lifecycle/react';

/**
 * The whole wiring a frontend host performs for @12-apps/entity-lifecycle
 * (12-17), in two parts, both driving the REAL generated endpoints over the
 * Vite proxy into `harness/backend`'s PGlite — the arrangement a real
 * consumer has (no `transport`, same-origin fetch, headerless requests act
 * as the seeded OWNER).
 *
 * 1. The PACKAGED page: Lixeira + Aprovações behind the package's own tabs —
 *    one call to `createWebEntityLifecycle({ apiBase })`.
 * 2. The HOST's own editor for its demo collection ("Itens"), which is the
 *    glue a real adopter already has: a list, an edit form, a delete button —
 *    composed with the packaged `VersionHistoryDialog` and `DraftBanner`, and
 *    saving through the host's own CRUD routes (which funnel every write
 *    through the packaged lifecycle, so an editor's save parks for approval
 *    and a delete lands in the Lixeira).
 */
/**
 * The HOST's entity vocabulary, supplied by the host — which is the whole of
 * what changed in `@12-apps/entity-lifecycle@3`. The package used to ship one
 * adopter's catalog and merge it UNDER whatever a host passed, so a host that
 * named only some of its collections silently inherited another product's word
 * for the rest. It ships none now; an unlabelled type renders as its raw key.
 *
 * `supplier` is deliberately left out even though the seed creates one: its
 * chip then reads `supplier` rather than a noun this package chose, which is
 * the zero-config behaviour a host gets before it names anything.
 */
const ENTITY_TYPE_LABELS = { product: 'Produto' };

const lifecycle = createWebEntityLifecycle({
  apiBase: '/api/admin/harness',
  entityTypeLabels: ENTITY_TYPE_LABELS,
});
const { page: LifecycleSurface, VersionHistoryDialog, DraftBanner, api } = lifecycle;

interface ItemWire {
  id: string;
  name: string;
  priceCents: number;
  publishedVersion: number;
}

interface SaveOutcome {
  applied: boolean;
  entityId: string | null;
  requestId: string | null;
}

async function fetchItems(): Promise<ItemWire[]> {
  const response = await fetch('/api/admin/harness/catalog-items', {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as { data: { items: ItemWire[] } };
  return payload.data.items;
}

async function sendItem(path: string, method: string, body?: unknown): Promise<SaveOutcome> {
  const response = await fetch(`/api/admin/harness/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json()) as { data?: SaveOutcome; error?: string };
  if (!response.ok && !payload.data) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload.data as SaveOutcome;
}

interface EditorState {
  name: string;
  setName: (value: string) => void;
  price: string;
  setPrice: (value: string) => void;
  draft: DraftWire | null;
  setDraft: (draft: DraftWire | null) => void;
  busy: boolean;
  save: () => Promise<void>;
  saveDraft: () => Promise<void>;
}

/** The edit-form state + the two host writes (save live / save as draft). */
function useItemEditor(item: ItemWire, onDone: (message: string | null) => void): EditorState {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.priceCents));
  const [draft, setDraft] = useState<DraftWire | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getDraft(`catalog-items/${item.id}`)
      .then((payload) => {
        if (!cancelled) setDraft(payload.draft);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const outcome = await sendItem(`catalog-items/${item.id}`, 'PUT', {
        name,
        priceCents: Number(price) || 0,
      });
      onDone(outcome.applied ? 'Item salvo.' : 'Alteração enviada para aprovação.');
    } catch (error) {
      onDone(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.saveDraft(`catalog-items/${item.id}`, {
        name,
        priceCents: Number(price) || 0,
      });
      if (result.ok) setDraft(result.data.draft);
    } finally {
      setBusy(false);
    }
  };

  return { name, setName, price, setPrice, draft, setDraft, busy, save, saveDraft };
}

/** The host's edit form: name + price, save (live) or save as draft. */
function ItemEditor({
  item,
  onDone,
}: {
  item: ItemWire;
  onDone: (message: string | null) => void;
}): JSX.Element {
  const editor = useItemEditor(item, onDone);

  return (
    <div style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, marginTop: 8 }}>
      {editor.draft && editor.draft.status === 'OPEN' && (
        <DraftBanner
          slug="catalog-items"
          draft={editor.draft}
          onLoad={(loaded) => {
            if (typeof loaded.data.name === 'string') editor.setName(loaded.data.name);
            if (loaded.data.priceCents !== undefined) editor.setPrice(String(loaded.data.priceCents));
          }}
          onPublished={(applied) => {
            editor.setDraft(null);
            onDone(applied ? 'Rascunho publicado.' : 'Alteração enviada para aprovação.');
          }}
          onDiscarded={() => editor.setDraft(null)}
        />
      )}
      <label>
        Nome{' '}
        <input
          data-testid="demo-item-name"
          value={editor.name}
          onChange={(event) => editor.setName(event.target.value)}
        />
      </label>{' '}
      <label>
        Preço (centavos){' '}
        <input
          data-testid="demo-item-price"
          value={editor.price}
          onChange={(event) => editor.setPrice(event.target.value)}
        />
      </label>{' '}
      <button
        type="button"
        data-testid="demo-item-save"
        disabled={editor.busy}
        onClick={() => void editor.save()}
      >
        Salvar
      </button>{' '}
      <button
        type="button"
        data-testid="demo-item-save-draft"
        disabled={editor.busy}
        onClick={() => void editor.saveDraft()}
      >
        Salvar rascunho
      </button>{' '}
      <button type="button" data-testid="demo-item-close" onClick={() => onDone(null)}>
        Fechar
      </button>
    </div>
  );
}

/** One list row: label + the three affordances every catalog grid has. */
function ItemRow({
  item,
  onEdit,
  onHistory,
  onDelete,
}: {
  item: ItemWire;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <li data-testid={`demo-item-${item.id}`}>
      <span>
        {item.name} — R$ {(item.priceCents / 100).toFixed(2)} (v{item.publishedVersion})
      </span>{' '}
      <button type="button" data-testid={`demo-item-edit-${item.id}`} onClick={onEdit}>
        Editar
      </button>{' '}
      <button type="button" data-testid={`demo-item-history-${item.id}`} onClick={onHistory}>
        Histórico
      </button>{' '}
      <button type="button" data-testid={`demo-item-delete-${item.id}`} onClick={onDelete}>
        Excluir
      </button>
    </li>
  );
}

/** The host's demo collection: list rows + editor + packaged history dialog. */
function DemoItems(): JSX.Element {
  const [items, setItems] = useState<ItemWire[] | null>(null);
  const [editing, setEditing] = useState<ItemWire | null>(null);
  const [history, setHistory] = useState<ItemWire | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchItems()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [generation]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  const remove = async (item: ItemWire): Promise<void> => {
    const outcome = await sendItem(`catalog-items/${item.id}`, 'DELETE');
    setMessage(outcome.applied ? 'Item movido para a lixeira.' : 'Exclusão enviada para aprovação.');
    refresh();
  };

  return (
    <section>
      <h2>Itens (host)</h2>
      {message && <p data-testid="demo-outcome">{message}</p>}
      {items === null ? (
        <p>Carregando…</p>
      ) : (
        <ul data-testid="demo-items">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onEdit={() => {
                setMessage(null);
                setEditing(item);
              }}
              onHistory={() => setHistory(item)}
              onDelete={() => void remove(item)}
            />
          ))}
        </ul>
      )}
      {editing && (
        <ItemEditor
          item={editing}
          onDone={(outcome) => {
            setEditing(null);
            setMessage(outcome);
            refresh();
          }}
        />
      )}
      {history && (
        <VersionHistoryDialog
          resourcePath={`catalog-items/${history.id}`}
          itemLabel={history.name}
          open
          onClose={() => setHistory(null)}
          onRestored={refresh}
        />
      )}
    </section>
  );
}

export function LifecycleAdminPage(): JSX.Element {
  return (
    <div>
      <DemoItems />
      <h2>Ciclo de vida (pacote)</h2>
      <LifecycleSurface />
    </div>
  );
}
