/**
 * Every word the data-display components used to hard-code in English is now
 * the caller's to replace, and the English one is still what a caller that
 * names nothing gets.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_CAROUSEL_COPY, EN_US_MAP_PREVIEW_COPY } from '../../../en-US.data-display';
import { PT_BR_UI_LABELS } from '../../../pt-BR.labels';
import { AlertDialog } from '../AlertDialog';
import { Carousel } from '../Carousel';
import { LazyImage } from '../LazyImage';
import { MapPreview } from '../MapPreview';
import { Stepper } from '../Stepper';
import { Table } from '../Table';
import { Timeline } from '../Timeline';

afterEach(cleanup);

describe('AlertDialog closeLabel', () => {
  it('names the corner close button with the caller label', () => {
    render(<AlertDialog open title="T" closeLabel="Fechar" onClose={vi.fn()} />);
    expect(screen.getByTestId('alert-dialog-close-button')).toHaveAccessibleName('Fechar');
  });

  it('keeps "close" when no label is given, and keeps the prop off the dialog', () => {
    render(<AlertDialog open title="T" onClose={vi.fn()} />);
    expect(screen.getByTestId('alert-dialog-close-button')).toHaveAccessibleName('close');
    expect(screen.getByTestId('alert-dialog')).not.toHaveAttribute('closelabel');
  });
});

describe('Carousel goToSlide', () => {
  const items = [
    { id: 'a', content: 'A' },
    { id: 'b', content: 'B' },
  ];

  it('names each indicator from the caller pack', () => {
    render(
      <Carousel
        items={items}
        copy={{ previous: 'Anterior', next: 'Próximo', goToSlide: (n) => `Ir para o slide ${n}` }}
      />,
    );
    expect(screen.getByTestId('carousel-indicator-1')).toHaveAccessibleName('Ir para o slide 2');
  });

  it('falls back to the English wording for a pack without the key', () => {
    render(<Carousel items={items} copy={{ previous: 'Anterior', next: 'Próximo' }} />);
    expect(screen.getByTestId('carousel-indicator-0')).toHaveAccessibleName(
      EN_US_CAROUSEL_COPY.goToSlide(1),
    );
  });
});

describe('LazyImage alts', () => {
  it('names the placeholder with the caller placeholderAlt', () => {
    render(
      <LazyImage
        src="real.png"
        alt="Pizza"
        placeholder="blur.png"
        loadingState="placeholder"
        lazy={false}
        placeholderAlt="Pizza (carregando)"
        data-testid="pic"
      />,
    );
    expect(screen.getByTestId('pic-placeholder')).toHaveAttribute('alt', 'Pizza (carregando)');
  });

  it('keeps "<alt> (loading)" when no placeholderAlt is given', () => {
    render(
      <LazyImage src="real.png" alt="Pizza" placeholder="blur.png" loadingState="placeholder" lazy={false} data-testid="pic" />,
    );
    expect(screen.getByTestId('pic-placeholder')).toHaveAttribute('alt', 'Pizza (loading)');
  });

  it('names the string fallback with the caller fallbackAlt once the image fails', () => {
    render(
      <LazyImage
        src="broken.png"
        alt="Pizza"
        fallback="fallback.png"
        fallbackAlt="Pizza (alternativa)"
        lazy={false}
        retryOnError={false}
        data-testid="pic"
      />,
    );
    fireEvent.error(screen.getByTestId('pic-img'));
    expect(screen.getByTestId('pic-fallback')).toHaveAttribute('alt', 'Pizza (alternativa)');
  });
});

describe('MapPreview optional copy keys', () => {
  it('reads the view description and the caption from the caller pack', () => {
    render(
      <MapPreview
        center={{ lat: 1, lng: 2 }}
        zoom={10}
        copy={{
          ...EN_US_MAP_PREVIEW_COPY,
          viewDescription: (lat, lng, zoom) => `Mapa em ${lat}, ${lng}, zoom ${zoom}`,
          coordinates: (lat, lng) => `Lat.: ${lat}, Long.: ${lng}`,
          zoomLevel: (zoom) => `Aproximação: ${zoom}`,
        }}
      />,
    );
    expect(screen.getByRole('img', { name: 'Mapa em 1.0000, 2.0000, zoom 10' })).toBeInTheDocument();
    expect(screen.getByTestId('coordinates-display')).toHaveTextContent('Lat.: 1.000000, Long.: 2.000000');
    expect(screen.getByTestId('coordinates-display')).toHaveTextContent('Aproximação: 10');
  });

  it('keeps the English wording for a pack written before the keys existed', () => {
    const { zoomIn, zoomOut, center, mapType, fullscreen, search } = EN_US_MAP_PREVIEW_COPY;
    render(
      <MapPreview
        center={{ lat: 1, lng: 2 }}
        zoom={10}
        copy={{ zoomIn, zoomOut, center, mapType, fullscreen, search }}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'Map preview centered at 1.0000, 2.0000 with zoom level 10' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('coordinates-display')).toHaveTextContent('Lat: 1.000000, Lng: 2.000000');
  });
});

describe('Stepper labels', () => {
  const steps = [
    { id: 'a', label: 'Carrinho' },
    { id: 'b', label: 'Entrega', optional: true },
  ];

  it('builds each circle name from the caller labels', () => {
    render(<Stepper steps={steps} activeId="a" labels={PT_BR_UI_LABELS.stepper} />);
    expect(screen.getByTestId('stepper-step-icon-0')).toHaveAccessibleName('Etapa 1: Carrinho (atual)');
    expect(screen.getByTestId('stepper-step-icon-1')).toHaveAccessibleName('Etapa 2: Entrega (opcional)');
    expect(screen.getByText('(opcional)')).toBeInTheDocument();
  });

  it('keeps the English names when no labels are given', () => {
    render(<Stepper steps={steps} activeId="a" />);
    expect(screen.getByTestId('stepper-step-icon-0')).toHaveAccessibleName('Step 1: Carrinho (current)');
    expect(screen.getByTestId('stepper-step-icon-1')).toHaveAccessibleName('Step 2: Entrega (optional)');
  });
});

describe('Table labels', () => {
  const columns = [{ key: 'name', label: 'Nome' }];
  const data = [{ id: 1, name: 'Ana' }];

  it('names the sort button and both checkboxes with the caller labels', () => {
    render(
      <Table
        emptyText="Nada"
        columns={columns}
        data={data}
        sortable
        selectable
        labels={PT_BR_UI_LABELS.table}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ordenar por Nome' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Selecionar todas as linhas' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Selecionar a linha 1' })).toBeInTheDocument();
  });

  it('keeps the English names when no labels are given', () => {
    render(<Table emptyText="Nada" columns={columns} data={data} sortable selectable />);
    expect(screen.getByRole('button', { name: 'Sort by Nome' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'select all' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'select row 1' })).toBeInTheDocument();
  });
});

describe('Timeline labels', () => {
  const items = [{ id: 'a', title: 'Pedido feito', timestamp: '10:00', description: 'Detalhes' }];

  it('names the card and the toggle with the caller labels', () => {
    render(<Timeline items={items} labels={PT_BR_UI_LABELS.timeline} />);
    expect(screen.getByRole('article', { name: 'Item da linha do tempo: Pedido feito' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostrar detalhes do item' })).toBeInTheDocument();
  });

  it('keeps the English names when no labels are given', () => {
    render(<Timeline items={items} />);
    expect(screen.getByRole('article', { name: 'Timeline item: Pedido feito' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand item details' })).toBeInTheDocument();
  });
});
