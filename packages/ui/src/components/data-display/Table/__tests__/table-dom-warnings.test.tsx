/**
 * RENDERING A TABLE LOGS NO DOM-NESTING OR UNKNOWN-PROP WARNING (FUT-2658).
 *
 * React warns once per prop name and tag pair per module, so a render earlier
 * in the same file would hide these. This file renders nothing else, and the
 * spy is installed before its first render.
 */
import { format } from 'node:util';

import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render } from '@testing-library/react';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { Table } from '../Table';
import type { ColumnConfig } from '../Table.types';

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

afterAll(() => {
  consoleError.mockRestore();
});

const DOM_WARNING =
  /cannot be a child of|cannot contain a nested|does not recognize the|non-boolean attribute|Invalid DOM property|Unknown event handler/;

const columns: ColumnConfig[] = [{ key: 'name', label: 'Nome' }];
const data = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `row-${i}` }));

describe('Table warnings', () => {
  it('renders a virtualised table without a DOM-nesting or unknown-prop warning', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <Table
          emptyText="Nenhum dado"
          columns={columns}
          data={data}
          virtualScrolling
          containerHeight={400}
          rowHeight={40}
          overscan={2}
          variant="striped"
          selectedRows={[1]}
          sortable={false}
          selectable={false}
          showColumnToggle
          columnPriorities={[1]}
          onRowClick={vi.fn()}
        />
      </ThemeProvider>,
    );

    const warnings = consoleError.mock.calls
      .map((args) => format(...args))
      .filter((message) => DOM_WARNING.test(message));
    expect(warnings).toEqual([]);
  });
});
