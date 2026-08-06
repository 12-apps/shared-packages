import { useState } from 'react';
import { useUnsavedChanges } from '@12-apps/report-builder/react';

/**
 * The published unsaved-changes hook, driven in a browser.
 *
 * Its two halves cannot be reached from the package's own suite: ⌘S is a
 * `window` keydown listener and the guard is `beforeunload`, and this package
 * runs vitest with `environment: 'node'` — no window, no events. The rules
 * (what counts as a change) are unit-tested; this proves they are WIRED.
 *
 * The draft here is deliberately trivial. What is under test is the hook, not
 * a report: a name and a width are enough to make an edit, undo it by hand,
 * and save.
 */
export function UnsavedChangesPage(): JSX.Element {
  const [name, setName] = useState('Vendas');
  const [span, setSpan] = useState(6);
  const [saveCount, setSaveCount] = useState(0);

  const { dirty, markSaved } = useUnsavedChanges({
    current: { name, span },
    onSave: () => {
      setSaveCount((count) => count + 1);
      markSaved({ name, span });
    },
  });

  return (
    <div data-testid="unsaved-changes">
      <h2 style={{ marginTop: 0 }}>Unsaved changes</h2>

      <p data-testid="dirty-state">{dirty ? 'Alterações não salvas' : 'Salvo'}</p>
      <p data-testid="save-count">{saveCount}</p>

      <label style={{ display: 'block', marginBottom: 12 }}>
        Nome{' '}
        <input
          data-testid="name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        Largura{' '}
        <select
          data-testid="span-select"
          value={String(span)}
          onChange={(event) => setSpan(Number(event.target.value))}
        >
          <option value="4">1/3</option>
          <option value="6">1/2</option>
          <option value="12">Inteira</option>
        </select>
      </label>

      <button
        type="button"
        data-testid="save-button"
        onClick={() => {
          setSaveCount((count) => count + 1);
          markSaved({ name, span });
        }}
      >
        Salvar
      </button>
    </div>
  );
}
