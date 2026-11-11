import { describe, expect, it } from 'vitest';

import { defineCatalog } from '../catalog';
import { reportBuilderRouter } from '../hono';
import { createMemoryDataSource } from '../memory';
import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import type { ReportBuilderServerConfig, SavedReportDb } from '../server';
import { PT_BR_REPORT_SERVER_MESSAGES } from '../server/pt-BR';

/**
 * The Hono binding keeps the transport/validation line: a body that is present
 * but is not JSON is a 400 (malformed JSON is never a validation problem), while
 * an absent or wrong-shaped body is the strict parse's 422.
 */
const CATALOG = defineCatalog({
  entities: {
    loans: {
      label: 'Loans',
      fields: { id: { label: 'Loan', type: 'string', role: 'dimension' } },
    },
  },
});

function mounted() {
  const config: ReportBuilderServerConfig = {
    catalog: CATALOG,
    adapter: () => createMemoryDataSource({}, 'Others'),
    copy: PT_BR_REPORT_ENGINE_COPY,
    messages: PT_BR_REPORT_SERVER_MESSAGES,
    db: () => Promise.resolve({} as unknown as SavedReportDb),
    entityPermission: { loans: 'loans:read' },
    systemReports: [],
    starters: {},
  } as unknown as ReportBuilderServerConfig;
  return reportBuilderRouter({
    ...config,
    resolveActor: () => ({
      clientId: 't-1',
      userId: 'u-1',
      roleIds: [],
      isAdmin: false,
      permissions: ['loans:read'],
    }),
  });
}

async function run(body: string | undefined) {
  const response = await mounted().request('/reports/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('the hono binding on a dry-run body', () => {
  it('answers 400 with the host sentence for a body that is not JSON', async () => {
    const answer = await run('not json');
    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({ error: PT_BR_REPORT_SERVER_MESSAGES.invalidBody });
  });

  it('answers 422 with problems for JSON of the wrong shape, and for no body', async () => {
    const wrong = await run('{"surprise":1}');
    expect(wrong.status).toBe(422);
    expect(wrong.body).toHaveProperty('problems');
    expect((await run(undefined)).status).toBe(422);
  });
});
