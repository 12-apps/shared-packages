// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';

import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from '../../server/pt-BR';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';
import { useSystemReport } from '../reports-api';
import { httpTransport, type ReportBuilderTransport } from '../transport';
import { ReportBuilderProvider } from '../transport-context';
import { TEST_SURFACE } from './surface-fixture';

/**
 * FUT-4070: a built-in report's read fails in the host's words too.
 *
 * `useSystemReport` used to read through a private `fetch` of its own that threw
 * `HTTP <status> for <path>` — English, with the request path in it — straight
 * into the block's error state. It now reads through the transport in scope,
 * so it fails as every other call on the surface does.
 */

function wrapperWith(transport: ReportBuilderTransport) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <QueryClientProvider client={client}>
        <ReportBuilderProvider
          transport={transport}
          tenantSlug="acme"
          surface={TEST_SURFACE}
          copy={{
            engine: PT_BR_REPORT_ENGINE_COPY,
            blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
            screens: PT_BR_REPORT_SCREENS_COPY,
          }}
        >
          {children}
        </ReportBuilderProvider>
      </QueryClientProvider>
    );
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useSystemReport', () => {
  it('fails with the status in the host words, without the path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const { result } = renderHook(() => useSystemReport('acme', 'vendas', '7d', 'day'), {
      wrapper: wrapperWith(httpTransport({ errors: PT_BR_REPORT_SCREENS_COPY.errors })),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Erro 503');
  });

  it("fails with the connection failure, never the browser's TypeError message", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { result } = renderHook(() => useSystemReport('acme', 'vendas', '7d', 'day'), {
      wrapper: wrapperWith(httpTransport({ errors: PT_BR_REPORT_SCREENS_COPY.errors })),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Falha de conexão');
  });

  it("reads through the host's transport", async () => {
    const get = vi.fn(async () => ({ key: 'vendas' }));
    const transport: ReportBuilderTransport = {
      get: get as ReportBuilderTransport['get'],
      getRaw: vi.fn() as ReportBuilderTransport['getRaw'],
      send: vi.fn() as ReportBuilderTransport['send'],
    };
    const { result } = renderHook(() => useSystemReport('acme', 'vendas', '7d', 'day'), {
      wrapper: wrapperWith(transport),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/api/admin/acme/reports/system/vendas?preset=7d&grain=day');
  });
});
