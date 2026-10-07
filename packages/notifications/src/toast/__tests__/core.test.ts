import { describe, expect, it, vi } from 'vitest';

import {
  TOAST_DURATION_MS,
  TOAST_ERROR_DURATION_MS,
  createToastStore,
  createToaster,
  defaultToastDuration,
} from '../core';

/**
 * The queue on its own: what raising, replacing, updating and dismissing do to
 * the list a view draws, and what each caller is told when its toast leaves.
 */

describe('toast store', () => {
  it('queues toasts oldest first, with the severity defaults', () => {
    const store = createToastStore();
    const first = store.show('Salvo', { severity: 'success' });
    const second = store.show('Falhou', { severity: 'error' });

    const items = store.getSnapshot();
    expect(items.map((item) => item.id)).toEqual([first, second]);
    expect(items[0]).toMatchObject({ message: 'Salvo', severity: 'success', duration: TOAST_DURATION_MS, dismissible: true });
    expect(items[1]).toMatchObject({ severity: 'error', duration: TOAST_ERROR_DURATION_MS });
  });

  it('keeps a loading toast up until it is told otherwise', () => {
    expect(defaultToastDuration('loading')).toBeNull();
    expect(defaultToastDuration('neutral')).toBe(TOAST_DURATION_MS);
  });

  it('replaces a toast raised again with the same id, in place, and says so to the old one', () => {
    const store = createToastStore();
    const onFirst = vi.fn();
    store.show('A', { id: 'other' });
    store.show('Pedido #1 movido', { id: 'receipt', onDismiss: onFirst });
    const before = store.getSnapshot().find((item) => item.id === 'receipt')?.revision;
    store.show('Pedido #2 movido', { id: 'receipt' });

    const items = store.getSnapshot();
    expect(items.map((item) => item.id)).toEqual(['other', 'receipt']);
    expect(items[1]?.message).toBe('Pedido #2 movido');
    expect(items[1]?.revision).toBeGreaterThan(before ?? Infinity);
    expect(onFirst).toHaveBeenCalledWith('replaced');
  });

  it('updates a toast in place, and a severity change takes the new severity lifetime', () => {
    const store = createToastStore();
    const id = store.show('Enviando…', { severity: 'loading', dismissible: false });
    store.update(id, { message: 'Enviado', severity: 'success' });

    expect(store.getSnapshot()[0]).toMatchObject({
      id,
      message: 'Enviado',
      severity: 'success',
      duration: TOAST_DURATION_MS,
      dismissible: false,
    });
  });

  it('keeps the stated duration on update when one is given', () => {
    const store = createToastStore();
    const id = store.show('x', { severity: 'loading' });
    store.update(id, { severity: 'error', duration: null });
    expect(store.getSnapshot()[0]?.duration).toBeNull();
  });

  it('ignores an update for a toast that already left', () => {
    const store = createToastStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.update('gone', { message: 'x' });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('dismisses one toast or all of them, telling each why', () => {
    const store = createToastStore();
    const onA = vi.fn();
    const onB = vi.fn();
    const a = store.show('A', { onDismiss: onA });
    store.show('B', { onDismiss: onB });

    store.dismiss(a, 'close');
    expect(onA).toHaveBeenCalledWith('close');
    expect(store.getSnapshot().map((item) => item.message)).toEqual(['B']);

    store.dismiss();
    expect(onB).toHaveBeenCalledWith('api');
    expect(store.getSnapshot()).toEqual([]);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const store = createToastStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.show('A');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.show('B');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('hands out the same snapshot until something changes', () => {
    const store = createToastStore();
    store.show('A');
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});

describe('toaster', () => {
  it('raises each severity through its shortcut', () => {
    const toaster = createToaster(createToastStore());
    toaster.success('ok');
    toaster.error('no');
    toaster.warning('hm');
    toaster.info('fyi');
    toaster.loading('…');
    toaster('plain');
    expect(toaster.store.getSnapshot().map((item) => item.severity)).toEqual([
      'success',
      'error',
      'warning',
      'info',
      'loading',
      'neutral',
    ]);
  });

  it('turns a promise loading toast into a success in place', async () => {
    const toaster = createToaster(createToastStore());
    await expect(
      toaster.promise(Promise.resolve(3), { loading: 'Salvando', success: (n) => `Salvos ${n}`, error: 'Falhou' }),
    ).resolves.toBe(3);
    const [item] = toaster.store.getSnapshot();
    expect(item).toMatchObject({ message: 'Salvos 3', severity: 'success', dismissible: true });
  });

  it('turns a promise loading toast into an error, and rethrows', async () => {
    const toaster = createToaster(createToastStore());
    const failure = new Error('boom');
    await expect(
      toaster.promise(Promise.reject(failure), { loading: 'Salvando', success: 'ok', error: (e) => `Falhou: ${String(e)}` }),
    ).rejects.toBe(failure);
    expect(toaster.store.getSnapshot()[0]).toMatchObject({ severity: 'error', message: 'Falhou: Error: boom' });
  });

  it('dismisses through the toaster', () => {
    const toaster = createToaster(createToastStore());
    const id = toaster('x');
    toaster.dismiss(id);
    expect(toaster.store.getSnapshot()).toEqual([]);
  });
});
