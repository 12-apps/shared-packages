// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { Drawer, DrawerContent, DrawerHeader } from '@12-apps/ui/layout/Drawer';

import { BlockEditorPanel } from '../block-editor-panel';
import type { ReportEntityFields, ReportField, ReportSpecWire } from '../custom-reports-api';
import { DockedPanelRegion } from '../lib/docked-panel';

/**
 * Plan entries 9 (side panel) and 12 (labelled sections) are both marked
 * ALREADY DONE. A status line rots the moment someone edits the file; these
 * cases are the version of that status that cannot.
 *
 * Entry 12's acceptance — "no unlabelled select in the panel" — is asserted
 * exactly: every combobox the panel renders must resolve to a non-empty
 * accessible name.
 *
 * Entry 9's acceptance — "no truncated control labels at any viewport >=360px"
 * — is asserted as far as jsdom honestly can. There is no layout engine here,
 * so nothing in this file proves a label does not overflow its box. What it
 * does prove is that BOTH layout branches — the 344px right-hand panel and the
 * bottom sheet below 760px — render every label in full, so a regression to
 * the popover's `St…` / `igu…` fails as a string rather than as a screenshot
 * nobody takes. Pixel overflow is a browser check.
 */

const FIELDS: ReportField[] = [
  { field: 'createdAt', label: 'Data', type: 'date', role: 'dimension' },
  { field: 'method', label: 'Forma de pagamento', type: 'string', role: 'dimension' },
  { field: 'status', label: 'Status', type: 'string', role: 'dimension' },
  { field: 'revenueCents', label: 'Receita', type: 'money', role: 'measure' },
];

const ENTITY: ReportEntityFields = {
  entity: 'orders',
  label: 'Pedidos',
  fields: FIELDS,
};

/** A date axis, so the grain select renders alongside the axis select. */
const SPEC: ReportSpecWire = {
  entity: 'orders',
  dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
  measures: [{ field: 'revenueCents', aggregation: 'sum' }],
  filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
  sort: [],
  presentation: { kind: 'chart', chartType: 'bar' },
};

const DESKTOP_PX = 1280;

/**
 * The width the stubbed `matchMedia` answers from. A container property rather
 * than a closed-over binding: the flakiness gate rejects reassigning the
 * latter from inside a stub, and a mutated container is the shape it wants.
 */
const viewport = { width: DESKTOP_PX };

const realMatchMedia = window.matchMedia;

/** Choose the branch this test renders. Read by the stub below. */
function setViewport(widthPx: number): void {
  viewport.width = widthPx;
}

/**
 * `useMediaQuery` reads `window.matchMedia`, which jsdom does not implement.
 * Answering from an explicit width makes the panel/sheet branch a choice the
 * test makes rather than a default it inherits — and installing it per test,
 * with a restore, keeps the mutation from leaking into any other suite.
 */
beforeEach(() => {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)/.exec(query);
    return {
      matches: max ? viewport.width <= Number(max[1]) : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
});

/** The panel, pointed at a block — or at nothing, for the empty state. */
function panelElement(spec: ReportSpecWire | null = SPEC): ReactElement {
  return (
    <BlockEditorPanel
      open
      onClose={() => undefined}
      entities={[ENTITY]}
      spec={spec}
      span={6}
      onChange={() => undefined}
      onSpanChange={() => undefined}
      testId="report-block-b1-editor"
    />
  );
}

function renderPanel(): void {
  render(panelElement());
}

/**
 * The accessible name as a screen reader would resolve it, without pulling in
 * jest-dom — this package's suites use plain vitest matchers.
 */
function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();

  const ids = element.getAttribute('aria-labelledby');
  if (ids === null) return '';
  return ids
    .split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
  viewport.width = DESKTOP_PX;
});

describe('BlockEditorPanel — entry 12: no unlabelled select in the panel', () => {
  it.each([
    ['the desktop panel', 1280],
    ['the bottom sheet', 390],
  ])('names every select in %s', (_branch, widthPx) => {
    setViewport(widthPx);
    renderPanel();

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);

    const unnamed = selects.filter((select) => accessibleName(select) === '');
    expect(unnamed).toEqual([]);
  });

  it('labels the axis, the grain and the series split as three separate controls', () => {
    setViewport(1280);
    renderPanel();

    const names = screen.getAllByRole('combobox').map(accessibleName);
    // MUI names a select from its label AND its current value, so the axis
    // reads "Eixo X Data". Match on the label each control leads with.
    const labelled = (label: string): boolean =>
      names.some((name) => name.startsWith(label));

    // The three the plan calls out by name. `Por` renders only for a date
    // axis, which SPEC has.
    expect(labelled('Eixo X')).toBe(true);
    expect(labelled('Por')).toBe(true);
    expect(labelled('Uma série por')).toBe(true);
  });

  it('names the measure and filter selects by their ROLE, not by their value', () => {
    setViewport(1280);
    renderPanel();

    const names = screen.getAllByRole('combobox').map(accessibleName);

    // These five carry `aria-label` rather than a visible label. Naming them
    // by value is the failure this pins: a filter's field select announcing
    // as "Status" tells a screen-reader user what it currently holds and
    // nothing about what it IS. `Status` is also a legitimate field label, so
    // asserting the role names is the only way to tell the two apart.
    expect(names).toEqual(
      expect.arrayContaining([
        'Medida 1',
        'Agregação',
        'Filtro 1 — campo',
        'Filtro 1 — condição',
      ]),
    );
  });
});

describe('BlockEditorPanel — entry 9: labels survive the narrow branch', () => {
  it.each([
    ['the desktop panel', 1280],
    ['the bottom sheet', 390],
  ])('renders no elided control label in %s', (_branch, widthPx) => {
    setViewport(widthPx);
    renderPanel();

    // The popover this replaced rendered `St…` and `igu…`. A horizontal
    // ellipsis anywhere in a control's accessible name is that failure back.
    const elided = screen
      .getAllByRole('combobox')
      .map(accessibleName)
      .filter((name) => name.includes('…'));
    expect(elided).toEqual([]);
  });

  it('keeps the full section headings at 390px', () => {
    setViewport(390);
    renderPanel();

    // Full strings, not prefixes: `getByText` with an exact string fails on a
    // truncated render.
    expect(screen.getByText('Agrupar por')).toBeTruthy();
    expect(screen.getByText('Separar em séries')).toBeTruthy();
  });
});

/**
 * FUT-755 — the panel is DOCKED and NON-MODAL.
 *
 * This is the distinction the whole redesign exists for, and the one that keeps
 * being lost: a modal drawer puts a backdrop, a scroll lock and a focus trap
 * over the canvas, and floats the form on top of the very block it configures.
 * The spec (`docs/reports-builder/specs/editor-config-panel.feature`, the
 * `@regression` scenarios) asks for the opposite at every point.
 *
 * jsdom has no layout engine, so nothing below proves that no pixel overlaps.
 * What it does prove is every INPUT to that overlap — no backdrop element, no
 * scroll lock, and the canvas actually GIVING UP the panel's width — each of
 * which fails loudly if the panel goes back to being a temporary drawer. The
 * geometry itself is a browser check.
 *
 * The bottom sheet is the deliberate exception, and is pinned as one.
 */

/** The width the docked panel takes out of the canvas — part of the contract. */
const PANEL_WIDTH_PX = 344;

const MOBILE_PX = 390;

/**
 * The scrims MUI has actually mounted.
 *
 * Queried by class because a backdrop carries no role and no accessible name —
 * its ABSENCE is the assertion, and there is nothing else to ask for.
 */
function renderedBackdrops(): Element[] {
  return Array.from(document.querySelectorAll('.MuiBackdrop-root'));
}

/** The panel rendered inside the canvas region that yields width to it. */
function renderDockedEditor(withPanel: boolean, spec: ReportSpecWire | null = SPEC): void {
  render(
    <DockedPanelRegion>
      <div data-testid="canvas-probe" />
      {withPanel ? panelElement(spec) : null}
    </DockedPanelRegion>,
  );
}

/**
 * Which of the three responsive layouts the panel chose, as it labels itself.
 *
 * The panel writes the tier onto its wrapper precisely so a test can ask. The
 * alternative — inferring the tier from the anchor class or the paper's width
 * — reads a CONSEQUENCE of the branch, and passes just as happily when the
 * branch is right for the wrong reason.
 */
function renderedTier(): string {
  return document.querySelector('[data-panel-tier]')?.getAttribute('data-panel-tier') ?? '';
}

/** The width the canvas gave up, as the region wrote it. */
function reservedGutter(): string {
  return screen.getByTestId('report-editor-region').style.paddingRight;
}

describe('BlockEditorPanel — FUT-755: docked, not modal', () => {
  it('renders no backdrop at desktop width', () => {
    setViewport(DESKTOP_PX);
    renderPanel();

    // Falsifiable: the panel really is on screen, so an empty backdrop list
    // cannot be the trivial "nothing rendered" pass.
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(renderedBackdrops()).toEqual([]);
  });

  it('leaves the page scrollable at desktop width', () => {
    setViewport(DESKTOP_PX);
    renderPanel();

    // A modal locks the body; `Ajustes` below shows what that looks like.
    expect(document.body.style.overflow).toBe('');
  });

  it('does not mark the rest of the page inert at desktop width', () => {
    setViewport(DESKTOP_PX);
    renderDockedEditor(true);

    const canvas = screen.getByTestId('canvas-probe');
    expect(canvas.closest('[aria-hidden="true"]')).toBe(null);
    expect(canvas.closest('[inert]')).toBe(null);
  });

  it('takes its width out of the canvas rather than covering it', () => {
    setViewport(DESKTOP_PX);
    renderDockedEditor(true);

    expect(reservedGutter()).toBe(`${PANEL_WIDTH_PX}px`);
  });

  it('leaves the canvas at full width while no panel is open', () => {
    setViewport(DESKTOP_PX);
    renderDockedEditor(false);

    // The other half of the case above: without it, a region that always pads
    // by 344px would pass and the canvas would never grow back.
    expect(reservedGutter()).toBe('0px');
  });

  it('reserves nothing for the bottom sheet', () => {
    setViewport(MOBILE_PX);
    renderDockedEditor(true);

    // A sheet on a phone legitimately overlays — there is no canvas width to
    // give up at 390px. Narrowing here would leave nothing to narrow.
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(reservedGutter()).toBe('0px');
  });

  it('keeps the sheet dismissible by an INVISIBLE backdrop below 760px', () => {
    setViewport(MOBILE_PX);
    renderPanel();

    // The sheet keeps a backdrop, because tapping the canvas above it must
    // close it — but it paints nothing, so the block being edited stays
    // legible above the sheet instead of sitting behind a scrim.
    const painted = renderedBackdrops().filter(
      (backdrop) => !backdrop.classList.contains('MuiBackdrop-invisible'),
    );
    expect(renderedBackdrops().length).toBe(1);
    expect(painted).toEqual([]);
  });
});

/**
 * FUT-755 — the THREE tiers, and the middle one the feature file adds:
 *
 *   @tablet
 *   Scenario: Between 760 px and 1100 px the panel overlays but stays non-modal
 *     Given the viewport is 1000 x 800
 *     When I select a block
 *     Then the panel is fixed to the right edge, overlaying the canvas
 *     And the panel casts a shadow to separate it from the content beneath
 *     And still no backdrop is rendered
 *     And clicking a block in the visible part of the canvas retargets the panel
 *
 * The arithmetic behind it: docking costs the canvas 344px, so a 1000px
 * viewport is left with ~656px — less than a wide block wants, so the block
 * being configured reflows into something that no longer resembles the report.
 * Overlaying keeps the canvas at its real width.
 *
 * What jsdom can hold: which branch was taken, and whether the canvas gave up
 * any width. The shadow itself, and the fact that the panel really does sit
 * ON TOP rather than beside, are browser checks — there is no layout engine
 * here to ask.
 */
describe('BlockEditorPanel — FUT-755: docked, overlay and sheet', () => {
  it.each([
    ['docks on a wide desktop', 1440, 'docked', `${PANEL_WIDTH_PX}px`],
    ['docks at exactly 1100px, the top of the overlay band', 1100, 'docked', `${PANEL_WIDTH_PX}px`],
    ['overlays one pixel below it', 1099, 'overlay', '0px'],
    ['overlays at the scenario’s 1000px', 1000, 'overlay', '0px'],
    ['overlays at exactly 760px, the bottom of the band', 760, 'overlay', '0px'],
    ['becomes a sheet one pixel below that', 759, 'sheet', '0px'],
    ['becomes a sheet on a phone', MOBILE_PX, 'sheet', '0px'],
  ])('%s', (_case, widthPx, tier, gutter) => {
    setViewport(widthPx);
    renderDockedEditor(true);

    expect(renderedTier()).toBe(tier);
    // The gutter is the whole difference between the tiers: docking TAKES the
    // width, overlaying borrows the pixels back for the duration.
    expect(reservedGutter()).toBe(gutter);
  });

  it('renders no backdrop in the overlay tier either', () => {
    setViewport(1000);
    renderDockedEditor(true);

    // "And still no backdrop is rendered" — the tier gives up the reflow, not
    // the non-modality. A scrim here would swallow the retargeting click the
    // scenario's last line asks for.
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(renderedBackdrops()).toEqual([]);
  });

  it('leaves the canvas operable in the overlay tier', () => {
    setViewport(1000);
    renderDockedEditor(true);

    const canvas = screen.getByTestId('canvas-probe');
    expect(canvas.closest('[aria-hidden="true"]')).toBe(null);
    expect(canvas.closest('[inert]')).toBe(null);
    expect(document.body.style.overflow).toBe('');
  });
});

/**
 * FUT-755 — the panel with NOTHING selected.
 *
 *   Scenario: Clicking the empty canvas background deselects
 *     … Then no block is selected
 *     And the panel shows its empty state with the text
 *         "Selecione um bloco para editar"
 *     And the panel remains docked and visible
 *
 * "Remains docked" is the load-bearing half: the empty state is a STATE of the
 * panel, not its absence, so the canvas keeps its 344px gutter and does not
 * snap wider and back between two clicks.
 */
describe('BlockEditorPanel — the empty state', () => {
  it('prompts for a selection instead of rendering a form', () => {
    setViewport(DESKTOP_PX);
    renderDockedEditor(true, null);

    expect(screen.getByText('Selecione um bloco para editar')).toBeTruthy();
    expect(screen.queryAllByRole('combobox')).toEqual([]);
  });

  it('stays docked, so the canvas does not jump when the selection clears', () => {
    setViewport(DESKTOP_PX);
    renderDockedEditor(true, null);

    expect(reservedGutter()).toBe(`${PANEL_WIDTH_PX}px`);
  });

  it('renders nothing at all as a sheet, which would cover the blocks', () => {
    setViewport(MOBILE_PX);
    renderDockedEditor(true, null);

    // A sheet overlays the canvas, so an empty one would hide the very blocks
    // the author is choosing between. The canvas probe is the control: the
    // region really did render, the panel simply is not in it.
    expect(screen.getByTestId('canvas-probe')).toBeTruthy();
    expect(screen.queryAllByText('Selecione um bloco para editar')).toEqual([]);
  });
});

describe('the settings drawer stays modal', () => {
  /**
   * The contrast case from the end of the feature file, and the reason it is
   * here: "make the block panel non-modal" must not become "make drawers
   * non-modal". Settings are a discrete task — a backdrop, a focus trap and a
   * scroll lock are correct for them. Block configuration is continuous work
   * beside the thing being configured, and they are wrong for it.
   *
   * A settings drawer is a default `@12-apps/ui` Drawer, so that default is
   * what this pins.
   */
  function renderSettingsDrawer(): void {
    render(
      <Drawer open onClose={() => undefined} anchor="right" dataTestId="settings-drawer">
        <DrawerHeader dataTestId="settings-drawer-header">Ajustes</DrawerHeader>
        <DrawerContent dataTestId="settings-drawer-content">
          <button type="button">Salvar ajustes</button>
        </DrawerContent>
      </Drawer>,
    );
  }

  it('covers the canvas with a painted backdrop', () => {
    setViewport(DESKTOP_PX);
    renderSettingsDrawer();

    expect(screen.getByTestId('settings-drawer-content')).toBeTruthy();
    const painted = renderedBackdrops().filter(
      (backdrop) => !backdrop.classList.contains('MuiBackdrop-invisible'),
    );
    expect(painted.length).toBe(1);
  });

  it('locks body scrolling, which the docked panel must not', () => {
    setViewport(DESKTOP_PX);
    renderSettingsDrawer();

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('renders as a dialog, which the docked panel must not', () => {
    setViewport(DESKTOP_PX);
    renderSettingsDrawer();

    expect(screen.getByRole('presentation')).toBeTruthy();
  });
});
