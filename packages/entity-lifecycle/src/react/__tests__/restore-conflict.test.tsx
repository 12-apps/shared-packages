// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { RestoreConflict } from '../../restore-conflict';
import { createWebEntityLifecycle } from '../create-web-entity-lifecycle';
import { PT_BR_LIFECYCLE_WEB_COPY } from '../pt-BR';
import type { LifecycleResult, LifecycleTransport } from '../transport';

/**
 * A restore the host refuses for a clash (FUT-1342): the Lixeira answers with
 * the rename dialog instead of an error banner, retries with what was typed,
 * keeps the dialog on a repeated clash and closes it on success.
 */

afterEach(cleanup);

const conflict = (codeError: string | null, code = '0042'): RestoreConflict => ({
  title: 'Restaurar com outro nome',
  message: 'A variação que está na lixeira usa o mesmo nome e o mesmo código de uma que está em Pizza agora.',
  binned: { heading: 'Na lixeira', label: 'Grande', detail: 'Código 0042 · 22 em estoque' },
  current: { heading: 'No produto agora', label: 'Grande', detail: 'Código 0042 · 4 em estoque' },
  fields: [
    { key: 'name', label: 'Novo nome', value: 'Grande (antiga)', error: null, optional: false },
    { key: 'sku', label: 'Novo código', value: code, error: codeError, optional: false },
  ],
});

const ENTRY = {
  id: 'bin-1',
  entityType: 'product',
  entityId: 'v1',
  label: 'Pizza Grande',
  deletedBy: null,
  deletedByName: null,
  deletedAt: new Date('2026-10-16T12:00:00Z').toISOString(),
  status: 'DELETED',
  children: [],
};

interface Send {
  path: string;
  body?: unknown;
}

/** Answers each restore with the next scripted result; reads list the one entry until it is restored. */
function scriptedTransport(results: LifecycleResult<unknown>[]): { transport: LifecycleTransport; sends: Send[] } {
  const sends: Send[] = [];
  // One object the fake reads and writes, rather than a reassigned binding.
  const bin = { restored: false };
  return {
    sends,
    transport: {
      async get<T>(): Promise<T> {
        return { data: { entries: bin.restored ? [] : [ENTRY] } } as T;
      },
      async send<T>(path: string, _method: string, body?: unknown): Promise<LifecycleResult<T>> {
        sends.push({ path, body });
        const next = results.shift() ?? { ok: true, data: undefined };
        if (next.ok) bin.restored = true;
        return next as LifecycleResult<T>;
      },
    },
  };
}

/** Clashes on the first send, then holds the retry until `release` is called. */
function heldTransport(): {
  transport: LifecycleTransport;
  sends: unknown[];
  release: (value: LifecycleResult<unknown>) => void;
} {
  const sends: unknown[] = [];
  const waiting: ((value: LifecycleResult<unknown>) => void)[] = [];
  const transport: LifecycleTransport = {
    async get<T>(): Promise<T> {
      return { data: { entries: [ENTRY] } } as T;
    },
    send<T>(_path: string, _method: string, body?: unknown): Promise<LifecycleResult<T>> {
      sends.push(body);
      if (sends.length === 1) return Promise.resolve(clash(null) as LifecycleResult<T>);
      return new Promise((resolve) => {
        waiting.push(resolve as (value: LifecycleResult<unknown>) => void);
      });
    },
  };
  return { transport, sends, release: (value) => waiting.shift()?.(value) };
}

function renderBin(transport: LifecycleTransport): void {
  const { page: Page } = createWebEntityLifecycle({
    apiBase: '/api/admin/loja',
    copy: PT_BR_LIFECYCLE_WEB_COPY,
    transport,
    entityTypeLabels: { product: 'Produto' },
  });
  render(<Page />);
}

/** A refused restore, as the host answers it: the field holds the value it refused. */
const clash = (codeError: string | null, code?: string): LifecycleResult<unknown> => ({
  ok: false,
  error: 'A variação que está na lixeira usa o mesmo nome',
  conflict: conflict(codeError, code),
});

describe('Lixeira restore clash', () => {
  it('opens the rename dialog with both rows and the host fields, focused on the first', async () => {
    const { transport, sends } = scriptedTransport([clash('Já usado por Pizza Grande.')]);
    renderBin(transport);
    fireEvent.click(await screen.findByTestId('recycle-bin-restore-bin-1'));

    const dialog = await screen.findByTestId('recycle-bin-conflict');
    expect(dialog.textContent).toContain('Restaurar com outro nome');
    expect(screen.getByTestId('recycle-bin-conflict-binned').textContent).toContain('Código 0042 · 22 em estoque');
    expect(screen.getByTestId('recycle-bin-conflict-current').textContent).toContain('No produto agora');
    const name = screen.getByLabelText(/Novo nome/) as HTMLInputElement;
    const code = screen.getByLabelText(/Novo código/) as HTMLInputElement;
    expect(name.value).toBe('Grande (antiga)');
    expect(code.value).toBe('0042');
    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByText('Já usado por Pizza Grande.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
    // A clash is a question, not a failure: no error banner over the list.
    await waitFor(() => expect(screen.queryByTestId('recycle-bin-error')).toBeNull());
    expect(sends).toHaveLength(1);
    expect(sends[0]?.body).toBeUndefined();
  });

  it('retries with the typed values, stays open on a repeated clash and closes on success', async () => {
    const { transport, sends } = scriptedTransport([
      clash('Já usado por Pizza Grande.'),
      clash('Já usado por Pizza Média.', '0043'),
      { ok: true, data: undefined },
    ]);
    renderBin(transport);
    fireEvent.click(await screen.findByTestId('recycle-bin-restore-bin-1'));
    await screen.findByTestId('recycle-bin-conflict');

    fireEvent.change(screen.getByLabelText(/Novo código/), { target: { value: '0043' } });
    fireEvent.click(screen.getByTestId('recycle-bin-conflict-restore'));
    await waitFor(() => expect(screen.getByText('Já usado por Pizza Média.')).toBeTruthy());
    expect(sends[1]?.body).toEqual({ overrides: { name: 'Grande (antiga)', sku: '0043' } });
    expect((screen.getByLabelText(/Novo código/) as HTMLInputElement).value).toBe('0043');

    fireEvent.change(screen.getByLabelText(/Novo código/), { target: { value: '0099' } });
    fireEvent.click(screen.getByTestId('recycle-bin-conflict-restore'));
    await waitFor(() => expect(screen.queryByTestId('recycle-bin-conflict')).toBeNull());
    expect(sends[2]?.body).toEqual({ overrides: { name: 'Grande (antiga)', sku: '0099' } });
    await screen.findByTestId('recycle-bin-empty');
  });

  it('drops a field error once the person types a new value', async () => {
    const { transport } = scriptedTransport([clash('Já usado por Pizza Grande.')]);
    renderBin(transport);
    fireEvent.click(await screen.findByTestId('recycle-bin-restore-bin-1'));
    const code = (await screen.findByLabelText(/Novo código/)) as HTMLInputElement;
    expect(code.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(code, { target: { value: '0043' } });
    await waitFor(() => expect(code.getAttribute('aria-invalid')).toBe('false'));
    await waitFor(() => expect(screen.queryByText('Já usado por Pizza Grande.')).toBeNull());
    fireEvent.change(code, { target: { value: '0042' } });
    await screen.findByText('Já usado por Pizza Grande.');
  });

  it('Cancelar closes the dialog and leaves the entry in the bin', async () => {
    const { transport, sends } = scriptedTransport([clash(null)]);
    renderBin(transport);
    fireEvent.click(await screen.findByTestId('recycle-bin-restore-bin-1'));
    await screen.findByTestId('recycle-bin-conflict');
    fireEvent.click(screen.getByTestId('recycle-bin-conflict-cancel'));
    await waitFor(() => expect(screen.queryByTestId('recycle-bin-conflict')).toBeNull());
    expect(screen.getByTestId('recycle-bin-entry-bin-1')).toBeTruthy();
    expect(sends).toHaveLength(1);
  });

  it('keeps Restaurar off while a required field is empty', async () => {
    const { transport, sends } = scriptedTransport([clash(null)]);
    renderBin(transport);
    fireEvent.click(await screen.findByTestId('recycle-bin-restore-bin-1'));
    await screen.findByTestId('recycle-bin-conflict');
    fireEvent.change(screen.getByLabelText(/Novo nome/), { target: { value: '  ' } });
    expect((screen.getByTestId('recycle-bin-conflict-restore') as HTMLButtonElement).disabled).toBe(true);
    expect(sends).toHaveLength(1);
  });

  it('shows a failure that is not a clash inside the dialog', async () => {
    const { transport } = scriptedTransport([clash(null), { ok: false, error: 'Não foi possível concluir.' }]);
    renderBin(transport);
    fireEvent.click(await screen.findByTestId('recycle-bin-restore-bin-1'));
    await screen.findByTestId('recycle-bin-conflict');
    fireEvent.click(screen.getByTestId('recycle-bin-conflict-restore'));
    await waitFor(() =>
      expect(screen.getByTestId('recycle-bin-conflict-error').textContent).toContain('Não foi possível concluir.'),
    );
    expect(screen.getByTestId('recycle-bin-conflict')).toBeTruthy();
  });

  it('shows a first-try failure that is not a clash in the banner, with no dialog', async () => {
    const { transport } = scriptedTransport([{ ok: false, error: 'O produto não existe mais.' }]);
    renderBin(transport);
    fireEvent.click(await screen.findByTestId('recycle-bin-restore-bin-1'));
    await waitFor(() =>
      expect(screen.getByTestId('recycle-bin-error').textContent).toContain('O produto não existe mais.'),
    );
    await waitFor(() => expect(screen.queryByTestId('recycle-bin-conflict')).toBeNull());
  });

  it('submits with Enter from a field', async () => {
    const { transport, sends } = scriptedTransport([clash(null), { ok: true, data: undefined }]);
    renderBin(transport);
    fireEvent.click(await screen.findByTestId('recycle-bin-restore-bin-1'));
    await screen.findByTestId('recycle-bin-conflict');
    fireEvent.submit(screen.getByLabelText(/Novo nome/).closest('form') as HTMLFormElement);
    await waitFor(() => expect(sends).toHaveLength(2));
    expect(sends[1]?.body).toEqual({ overrides: { name: 'Grande (antiga)', sku: '0042' } });
  });

  it('opens a field the host adds on a retry with its prefill, and focuses the field in error', async () => {
    const nameOnly: RestoreConflict = { ...conflict(null), fields: [conflict(null).fields[0]!] };
    const addsCode: RestoreConflict = {
      ...conflict('Já usado por Pizza Grande.'),
      fields: [
        { key: 'name', label: 'Novo nome', value: 'ignored', error: null, optional: false },
        { key: 'sku', label: 'Novo código', value: '0042-b', error: 'Já usado por Pizza Grande.', optional: false },
      ],
    };
    const { transport } = scriptedTransport([
      { ok: false, error: 'x', conflict: nameOnly },
      { ok: false, error: 'x', conflict: addsCode },
    ]);
    renderBin(transport);
    fireEvent.click(await screen.findByTestId('recycle-bin-restore-bin-1'));
    await screen.findByTestId('recycle-bin-conflict');
    fireEvent.change(screen.getByLabelText(/Novo nome/), { target: { value: 'Grande B' } });
    fireEvent.click(screen.getByTestId('recycle-bin-conflict-restore'));

    const code = (await screen.findByLabelText(/Novo código/)) as HTMLInputElement;
    expect(code.value).toBe('0042-b');
    // What was typed survives; the host's value for an already-typed key does not override it.
    expect((screen.getByLabelText(/Novo nome/) as HTMLInputElement).value).toBe('Grande B');
    await waitFor(() => expect(document.activeElement).toBe(code));
  });

  it('cannot be dismissed with Escape while a retry is running', async () => {
    const { transport, sends, release } = heldTransport();
    renderBin(transport);
    fireEvent.click(await screen.findByTestId('recycle-bin-restore-bin-1'));
    const dialog = await screen.findByTestId('recycle-bin-conflict');
    fireEvent.click(screen.getByTestId('recycle-bin-conflict-restore'));
    await waitFor(() => expect(sends).toHaveLength(2));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByTestId('recycle-bin-conflict')).toBeTruthy();
    release({ ok: false, error: 'Não foi possível concluir.' });
    await screen.findByTestId('recycle-bin-conflict-error');
  });
});
