/**
 * Every word the feedback components used to hard-code in English is now the
 * caller's to replace, and the English one is still what a caller that names
 * nothing gets.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_TUTORIAL_COPY } from '../../../en-US.feedback';
import { SonnerProvider, useSonner } from '../Sonner';
import type { SonnerContextType } from '../Sonner';
import { StackedModal, StackedModalProvider } from '../StackedModal';
import { Toast } from '../Toast';
import { TutorialOverlay } from '../TutorialOverlay';

afterEach(cleanup);

describe('Toast closeLabel', () => {
  it('names the close button with the caller label', () => {
    render(<Toast id="t" message="Salvo" closeLabel="Dispensar" dataTestId="t" />);
    expect(screen.getByTestId('t-close')).toHaveAccessibleName('Dispensar');
  });

  it('keeps "close" when no label is given', () => {
    render(<Toast id="t" message="Salvo" dataTestId="t" />);
    expect(screen.getByTestId('t-close')).toHaveAccessibleName('close');
  });
});

describe('SonnerProvider hiddenCountLabel', () => {
  // The hook's API, captured from inside the provider so the test can queue toasts.
  const api: { current?: SonnerContextType } = {};
  const Capture: React.FC = () => {
    api.current = useSonner();
    return null;
  };

  const queueSeven = () =>
    act(() => {
      for (let i = 0; i < 7; i += 1) api.current?.toast(`toast ${i}`, { duration: 60_000 });
    });

  it('words the overflow line with the caller function', () => {
    render(
      <SonnerProvider dismissLabel="Dispensar" hiddenCountLabel={(n) => `+${n} a mais`}>
        <Capture />
      </SonnerProvider>,
    );
    queueSeven();
    expect(screen.getByText('+2 a mais')).toBeInTheDocument();
  });

  it('keeps "+N more" when no function is given', () => {
    render(
      <SonnerProvider dismissLabel="Dismiss">
        <Capture />
      </SonnerProvider>,
    );
    queueSeven();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });
});

describe('StackedModal closeLabel', () => {
  it('names the root panel close button with the caller label', () => {
    render(
      <StackedModalProvider>
        <StackedModal backLabel="Voltar" closeLabel="Fechar" open onClose={vi.fn()} navigationTitle="T" modalId="one">
          <p>body</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('keeps "close" when no label is given', () => {
    render(
      <StackedModalProvider>
        <StackedModal backLabel="Voltar" open onClose={vi.fn()} navigationTitle="T" modalId="one">
          <p>body</p>
        </StackedModal>
      </StackedModalProvider>,
    );
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument();
  });
});

describe('TutorialOverlay progress', () => {
  const steps = [
    { id: 'a', target: '#tour-a', title: 'Primeiro', content: 'Um' },
    { id: 'b', target: '#tour-a', title: 'Segundo', content: 'Dois' },
  ];

  const renderTour = (copy: typeof EN_US_TUTORIAL_COPY | Omit<typeof EN_US_TUTORIAL_COPY, 'progress'>) =>
    render(
      <>
        <div id="tour-a">alvo</div>
        <TutorialOverlay copy={copy} steps={steps} active showProgress animated={false} />
      </>,
    );

  it('words the progress line with the caller pack', () => {
    renderTour({ ...EN_US_TUTORIAL_COPY, progress: (current, total) => `${current} de ${total}` });
    expect(screen.getByText('1 de 2')).toBeInTheDocument();
  });

  it('keeps "N of M" for a pack written before the key existed', () => {
    const { progress: _progress, ...older } = EN_US_TUTORIAL_COPY;
    renderTour(older);
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });
});
