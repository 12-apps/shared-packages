// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from '../../server/pt-BR';
import { createWebReportBuilder } from '../create-report-builder';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';
import { httpTransport } from '../transport';
import { TEST_SURFACE } from './surface-fixture';

vi.mock('../transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../transport')>();
  return { ...actual, httpTransport: vi.fn(actual.httpTransport) };
});

/**
 * FUT-4070: a host that names no transport gets the default one worded by the
 * copy it mounted, so its failures read as the rest of its screens do. The
 * words themselves are pinned in `transport-errors.test.ts`; this pins that the
 * mount hands them over.
 */
describe('createWebReportBuilder without a transport', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("builds the default transport with the mounted copy's error words", () => {
    // Nothing answers: the assertion is about the wiring, not a response.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { page: Surface } = createWebReportBuilder({
      surface: TEST_SURFACE,
      copy: {
        engine: PT_BR_REPORT_ENGINE_COPY,
        blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
        screens: PT_BR_REPORT_SCREENS_COPY,
      },
      tenantSlug: 'acme',
      standalone: true,
    });
    render(<Surface />);
    expect(httpTransport).toHaveBeenCalledWith({ errors: PT_BR_REPORT_SCREENS_COPY.errors });
  });
});
