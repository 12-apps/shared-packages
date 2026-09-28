import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chipClasses } from '@mui/material/Chip/index.js';
import { switchClasses } from '@mui/material/Switch/index.js';
import { tableCellClasses } from '@mui/material/TableCell/index.js';
import { createTheme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import {
  chipDensityOverrides,
  switchDensityOverrides,
  tableCellDensityOverrides,
} from '../density-overrides';

/**
 * FUT-2993 — the eager-modules regression (child ticket of FUT-2967).
 *
 * `density-overrides.ts`/`.selection.ts`/`.navigation.ts` used to import
 * `chipClasses`/`switchClasses`/`tableCellClasses` from the component's own
 * `@mui/material/{Chip,Switch,TableCell}` entry, which pulled `MuiChip`/
 * `MuiSwitch`/`MuiTableCell` onto the critical path of every host that
 * imports `densityThemeOptions` — including one that never renders a
 * density at all (`@12-apps/app-shell`'s `createAppTheme`,
 * one adopter's critical-path gate, FUT-2967).
 *
 * This file has two independent guards:
 *
 * 1. A SOURCE-level check (read with `node:fs`, not a bundler): none of the
 *    three modules' own text imports from the component subpaths at all.
 *    This is deliberately a text check, not a module-graph one — it fails
 *    the moment someone re-adds the import, before a bundler analysis would
 *    even need to run.
 * 2. A REGRESSION guard: with the component import gone, the selectors the
 *    overrides still emit are pixel/string-identical to the ones the old
 *    class maps produced. This file is allowed to import the class maps —
 *    only the three SOURCE files must not.
 */

const SOURCE_FILES = [
  '../density-overrides.ts',
  '../density-overrides.selection.ts',
  '../density-overrides.navigation.ts',
] as const;

const FORBIDDEN_SPECIFIER_RE = /from\s+['"]@mui\/material\/(Chip|Switch|TableCell)(\/|['"])/;

function readSource(relativePath: string): string {
  // The claim is about the real source text on disk — a mocked fs would only
  // assert what this file put in it, defeating the guard's whole point.
  // eslint-disable-next-line test-flakiness/no-unmocked-fs
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('density overrides stay off @mui/material/{Chip,Switch,TableCell} (FUT-2993)', () => {
  it.each(SOURCE_FILES)('%s imports nothing from the component entry', (relativePath) => {
    const source = readSource(relativePath);
    expect(source).not.toMatch(FORBIDDEN_SPECIFIER_RE);
  });
});

describe('the emitted selectors are unchanged (regression guard, FUT-2993)', () => {
  it("chipDensityOverrides' outlined label selector equals chipClasses.label", () => {
    const theme = createTheme();
    const overrides = chipDensityOverrides();
    const root = overrides.MuiChip?.styleOverrides?.root;
    if (typeof root !== 'function') throw new Error('MuiChip.root is not a style-override function');
    const style = root({ theme, ownerState: { variant: 'outlined', size: 'medium' } }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(style)).toContain(`& .${chipClasses.label}`);
  });

  it("switchDensityOverrides' checked/switchBase/thumb selectors equal switchClasses.checked/switchBase/thumb", () => {
    const theme = createTheme();
    const overrides = switchDensityOverrides();
    const switchBase = overrides.MuiSwitch?.styleOverrides?.switchBase;
    const sizeSmall = overrides.MuiSwitch?.styleOverrides?.sizeSmall;
    if (typeof switchBase !== 'function' || typeof sizeSmall !== 'function') {
      throw new Error('MuiSwitch.switchBase/sizeSmall is not a style-override function');
    }

    const switchBaseStyle = switchBase({ theme, ownerState: {} }) as Record<string, unknown>;
    expect(Object.keys(switchBaseStyle)).toContain(`&.${switchClasses.checked}`);

    const sizeSmallStyle = sizeSmall({ theme, ownerState: {} }) as Record<string, unknown>;
    expect(Object.keys(sizeSmallStyle)).toContain(`& .${switchClasses.switchBase}`);
    expect(Object.keys(sizeSmallStyle)).toContain(`& .${switchClasses.thumb}`);

    const nestedSwitchBase = sizeSmallStyle[`& .${switchClasses.switchBase}`] as Record<string, unknown>;
    expect(Object.keys(nestedSwitchBase)).toContain(`&.${switchClasses.checked}`);
  });

  it("tableCellDensityOverrides' checkbox-padding selector equals tableCellClasses.paddingCheckbox", () => {
    const theme = createTheme();
    const overrides = tableCellDensityOverrides();
    const sizeSmall = overrides.MuiTableCell?.styleOverrides?.sizeSmall;
    if (typeof sizeSmall !== 'function') throw new Error('MuiTableCell.sizeSmall is not a style-override function');
    const style = sizeSmall({ theme, ownerState: { padding: 'normal' } }) as Record<string, unknown>;
    expect(Object.keys(style)).toContain(`&.${tableCellClasses.paddingCheckbox}`);
  });
});
