/**
 * The layout rules that keep five FUT-3860 surfaces inside a 320px screen while
 * desktop keeps its old size. jsdom lays nothing out, so each case pins the CSS
 * rule itself: the desktop size survives as the first argument of `min()`, and
 * the second is what binds on a phone. The rendered numbers are in the PR.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Stepper } from '../components/data-display/Stepper';
import type { TutorialCopy } from '../copy';
import { SonnerProvider, useSonner } from '../components/feedback/Sonner/Sonner';
import { TutorialOverlay } from '../components/feedback/TutorialOverlay';
import { CommandPalette } from '../components/navigation/CommandPalette';
import { Code } from '../components/typography/Code';
import { EN_US_TUTORIAL_COPY } from '../en-US.feedback';
import { EN_US_COMMAND_PALETTE_COPY } from '../en-US.navigation';
import { PT_BR_TUTORIAL_COPY } from '../pt-BR.feedback';

afterEach(cleanup);

const style = (element: Element) => window.getComputedStyle(element);

/** The declarations emotion emitted for `element`'s classes under one media query. */
const mediaRules = (element: Element, media: string): string =>
  Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText.replace(/\s/g, '') === media)
    .flatMap((rule) => Array.from(rule.cssRules) as CSSStyleRule[])
    .filter((rule) => Array.from(element.classList).some((cls) => rule.selectorText.includes(`.${cls}`)))
    .map((rule) => rule.style.cssText.replace(/\s/g, ''))
    .join(';');

describe('CommandPalette width', () => {
  it('keeps 640 as the cap and yields to the dialog width below it', () => {
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        commands={[{ id: 'a', label: 'Abrir pedidos', action: vi.fn() }]}
        copy={EN_US_COMMAND_PALETTE_COPY}
      />,
    );
    const palette = screen.getByTestId('command-palette-input').closest('.MuiPaper-root:not(.MuiDialog-paper)');
    expect(palette).not.toBeNull();
    expect(style(palette as Element).maxWidth).toBe('min(40rem, 100%)');
    expect(style(palette as Element).width).toBe('40rem');
  });
});

describe('TutorialOverlay card', () => {
  const renderTour = (copy: TutorialCopy = EN_US_TUTORIAL_COPY) => {
    render(
      <>
        <div id="tour-target">alvo</div>
        <TutorialOverlay
          copy={copy}
          active
          allowSkip
          animated={false}
          steps={[
            { id: 'a', target: '#tour-target', title: 'Primeiro', content: 'Um' },
            { id: 'b', target: '#tour-target', title: 'Segundo', content: 'Dois' },
          ]}
        />
      </>,
    );
  };

  it('caps the card at 360 and at the viewport less its 16px clearance', () => {
    renderTour();
    expect(style(screen.getByRole('dialog')).maxWidth).toBe('min(22.5rem, calc(100vw - 2rem))');
  });

  it('wraps the button row on a phone only, with the second group held to the right', () => {
    renderTour();
    const row = screen.getByTestId('tutorial-navigation');
    // jsdom applies no media query, so this is the phone rule...
    expect(style(row).flexWrap).toBe('wrap');
    // ...and from `sm` (600px) up the row stays one line, as it was.
    expect(mediaRules(row, '(min-width:600px)')).toContain('flex-wrap:nowrap');
    const nextGroup = within(row).getByTestId('tutorial-next-button').parentElement as Element;
    expect(style(nextGroup).marginLeft).toBe('auto');
  });

  it('names the close button "Close" when the pack has no close key', () => {
    const { close: _close, ...older } = EN_US_TUTORIAL_COPY;
    renderTour(older);
    expect(screen.getByTestId('tutorial-close-button')).toHaveAccessibleName('Close');
  });

  it('names the close button from the pt-BR pack', () => {
    renderTour(PT_BR_TUTORIAL_COPY);
    expect(screen.getByTestId('tutorial-close-button')).toHaveAccessibleName('Fechar');
  });
});

describe('Sonner toast width', () => {
  const Trigger = ({ onReady }: { onReady: (show: () => void) => void }) => {
    const { toast } = useSonner();
    onReady(() => toast('Pedido confirmado'));
    return null;
  };

  it('keeps 356–400 on desktop and the viewport less 32 on a phone', () => {
    const shows: Array<() => void> = [];
    render(
      <SonnerProvider dismissLabel="Fechar">
        <Trigger onReady={(show) => shows.push(show)} />
      </SonnerProvider>,
    );
    act(() => shows[0]?.());
    const toast = screen.getByText('Pedido confirmado').closest('[aria-atomic="true"]') as Element;
    expect(style(toast).minWidth).toBe('min(22.25rem, calc(100vw - 2rem))');
    expect(style(toast).maxWidth).toBe('min(25rem, calc(100vw - 2rem))');
  });
});

describe('Stepper horizontal fit', () => {
  const steps = [
    { id: 's1', label: 'Dados da loja', description: 'Nome, endereço e horário' },
    { id: 's2', label: 'Formas de pagamento', optional: true },
    { id: 's3', label: 'Revisão', description: 'Confira antes de publicar' },
  ];

  it('lets the step column yield below its size stop to the step less its connector', () => {
    render(<Stepper steps={steps} activeId="s2" />);
    expect(style(screen.getByTestId('stepper-step-content-0')).minWidth).toBe('min(5rem, calc(100% - 1.5rem))');
    expect(style(screen.getByTestId('stepper-connector-0')).minWidth).toBe('0.5rem');
  });

  it('gives the last step a share capped at its own width, not a fixed one', () => {
    render(<Stepper steps={steps} activeId="s2" />);
    const last = style(screen.getByTestId('stepper-step-2'));
    expect(last.flexGrow).toBe('1');
    expect(last.flexShrink).toBe('1');
    expect(last.maxWidth).toBe('max-content');
  });

  it('breaks a word too wide for its column', () => {
    render(<Stepper steps={steps} activeId="s2" />);
    expect(style(screen.getByTestId('stepper-step-label-1')).overflowWrap).toBe('anywhere');
  });

  it('leaves the vertical stepper as it was', () => {
    render(<Stepper steps={steps} activeId="s2" orientation="vertical" />);
    expect(style(screen.getByTestId('stepper-step-2')).flexGrow).toBe('0');
    expect(style(screen.getByTestId('stepper-step-label-1')).overflowWrap).not.toBe('anywhere');
  });
});

describe('Code language badge', () => {
  it('starts the first line below the badge', () => {
    render(
      <Code variant="block" language="bash" data-testid="code">
        pnpm install
      </Code>,
    );
    expect(style(screen.getByTestId('code')).paddingTop).toBe('calc(16px + 1.5rem)');
  });

  it('keeps the block padding when no badge shows', () => {
    render(
      <Code variant="block" data-testid="code">
        pnpm install
      </Code>,
    );
    expect(style(screen.getByTestId('code')).paddingTop).toBe('1rem');
  });
});
