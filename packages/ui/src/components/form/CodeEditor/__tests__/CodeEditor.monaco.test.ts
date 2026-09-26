import { loader, type Monaco } from '@monaco-editor/react';
import type { Environment } from 'monaco-editor';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureCodeEditor } from '../CodeEditor.monaco';

describe('configureCodeEditor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (self as unknown as { MonacoEnvironment?: Environment }).MonacoEnvironment;
  });

  it("calls loader.config with the host's monaco instance", () => {
    const configSpy = vi.spyOn(loader, 'config');
    const monaco = {} as Monaco;
    const getWorker: NonNullable<Environment['getWorker']> = vi.fn();

    configureCodeEditor({ monaco, getWorker });

    // This is what stops @monaco-editor/react's default loader fetching its
    // own Monaco copy from cdn.jsdelivr.net at runtime (FUT-2697): once the
    // loader holds a monaco instance, `loader.init()` resolves with it
    // directly instead of injecting a <script> tag.
    expect(configSpy).toHaveBeenCalledWith({ monaco });
  });

  it('sets self.MonacoEnvironment.getWorker to the given factory', () => {
    const monaco = {} as Monaco;
    const getWorker: NonNullable<Environment['getWorker']> = vi.fn();

    configureCodeEditor({ monaco, getWorker });

    const env = (self as unknown as { MonacoEnvironment?: Environment }).MonacoEnvironment;
    expect(env?.getWorker).toBe(getWorker);
  });
});
