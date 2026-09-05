import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Card } from './Card.native';
import { cardInk, cardLook, cardRadius, cardSurface, type CardLookArgs } from './Card.look.native';
import {
  CARD_ACTIONS,
  CARD_HEADER,
  CARD_PAPER_SHADOW,
  type CardShadow,
} from './Card.metrics';
import {
  CardActions,
  CardContent,
  CardHeader,
  CardMedia,
  cardSubtitleStyle,
  cardTitleStyle,
  mediaHeight,
} from './CardParts.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid` and the
 * resolved style is what the browser would paint. What is asserted is the
 * NUMBERS — the same ones `Card.styles.ts` derives its CSS from — and the
 * structure the shared stories address.
 */
const theme = createUiTheme();
const dark = createUiTheme({ mode: 'dark' });

function look(over: Partial<CardLookArgs> = {}): ReturnType<typeof cardLook> {
  return cardLook(theme, {
    variant: 'elevated',
    interactive: false,
    glow: false,
    pulse: false,
    loading: false,
    borderRadius: 'md',
    ...over,
  });
}

const shadows = (style: { boxShadow?: unknown }): CardShadow[] => style.boxShadow as CardShadow[];

describe('Card (native)', () => {
  it('renders its children under the default test id and every spelling of a custom one', () => {
    render(
      <>
        <Card>
          <CardContent>corpo</CardContent>
        </Card>
        <Card testID="a">a</Card>
        <Card dataTestId="b">b</Card>
        <Card {...{ 'data-testid': 'c' }}>c</Card>
      </>,
    );

    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByTestId('card-content')).toHaveTextContent('corpo');
    for (const id of ['a', 'b', 'c']) expect(screen.getByTestId(id)).toHaveTextContent(id);
  });

  it('sits on the paper at MUI elevation 1, clipped, the way a MuiCard does', () => {
    const { container } = look();
    expect(container.backgroundColor).toBe(theme.palette.background.paper);
    expect(container.overflow).toBe('hidden');
    expect(container.opacity).toBe(1);
    expect(container.pointerEvents).toBe('auto');
    expect(shadows(container)).toEqual(CARD_PAPER_SHADOW);
  });

  it('cuts every named radius to the web lengths', () => {
    expect(cardRadius(theme, 'none')).toBe(0);
    expect(cardRadius(theme, 'sm')).toBe(4);
    expect(cardRadius(theme, 'md')).toBe(8);
    expect(cardRadius(theme, 'lg')).toBe(16);
    expect(cardRadius(theme, 'xl')).toBe(24);
    expect(cardRadius(theme, 'full')).toBe('50%');
  });

  it('paints each variant with the web palette arithmetic', () => {
    const outlined = cardSurface(theme, 'outlined', false).surface;
    expect(outlined.borderWidth).toBe(1);
    expect(outlined.borderColor).toBe(theme.palette.divider);
    expect(outlined.boxShadow).toBeUndefined();

    const glass = cardSurface(theme, 'glass', false).surface;
    expect(glass.backgroundColor).toBe('rgba(255, 255, 255, 0.1)');
    expect(glass.borderColor).toBe('rgba(99, 102, 241, 0.2)');
    expect(shadows(glass)[0]).toMatchObject({ offsetY: 8, blurRadius: 32, color: 'rgba(0, 0, 0, 0.1)' });

    const gradient = cardSurface(theme, 'gradient', false).surface;
    expect(gradient.backgroundColor).toBe(theme.palette.primary.main);
    expect(cardInk(theme, 'gradient')).toBe(theme.palette.primary.contrastText);

    const section = cardSurface(theme, 'section', false).surface;
    expect(section.backgroundColor).toBe('rgba(0, 0, 0, 0.02)');
    expect(cardSurface(dark, 'section', true).hover.backgroundColor).toBe('rgba(0, 0, 0, 0.25)');
  });

  it('offsets the neumorphic pair by 8 and blurs it twice as far', () => {
    const neumorphic = cardSurface(theme, 'neumorphic', true);
    expect(neumorphic.surface.backgroundColor).toBe(theme.palette.grey[100]);
    expect(shadows(neumorphic.surface)).toEqual([
      { offsetX: 8, offsetY: 8, blurRadius: 16, spreadDistance: 0, color: 'rgba(189, 189, 189, 0.2)' },
      { offsetX: -8, offsetY: -8, blurRadius: 16, spreadDistance: 0, color: 'rgba(255, 255, 255, 0.8)' },
    ]);
    // `lifted` is the interactive card's hover: 12px out, blurred 24.
    expect(shadows(neumorphic.hover)[0]).toMatchObject({ offsetX: 12, blurRadius: 24 });
  });

  it('haloes a glowing card at 20px and widens it to 30 under a press', () => {
    const glowing = look({ glow: true });
    expect(shadows(glowing.container)).toEqual([
      { offsetX: 0, offsetY: 0, blurRadius: 20, spreadDistance: 0, color: 'rgba(99, 102, 241, 0.3)' },
    ]);
    expect(shadows(glowing.pressed)).toEqual([
      { offsetX: 0, offsetY: 0, blurRadius: 30, spreadDistance: 0, color: 'rgba(99, 102, 241, 0.4)' },
    ]);
    // A variant that declares its own shadow buries the glow, exactly as the
    // `sx` spread order does on the web.
    expect(shadows(look({ glow: true, variant: 'glass' }).container)[0]).toMatchObject({ blurRadius: 32 });
  });

  it('turns the clip off for the pulse ring only', () => {
    expect(look({ pulse: true }).container.overflow).toBe('visible');
    render(
      <Card pulse dataTestId="pulsing">
        <CardContent>x</CardContent>
      </Card>,
    );
    expect(screen.getByTestId('pulsing-pulse')).toBeInTheDocument();
  });

  it('marks an interactive card as a pointer target and fires both handler spellings', () => {
    const onClick = vi.fn();
    const onPress = vi.fn();
    render(
      <Card interactive onClick={onClick} onPress={onPress} dataTestId="pressable">
        <CardContent>x</CardContent>
      </Card>,
    );

    expect(look({ interactive: true }).container.cursor).toBe('pointer');
    fireEvent.click(screen.getByTestId('pressable'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('makes a loading card inert and announces the spinner', () => {
    const onClick = vi.fn();
    const loading = look({ loading: true });
    expect(loading.container.opacity).toBe(0.6);
    expect(loading.container.pointerEvents).toBe('none');

    render(
      <Card loading interactive onClick={onClick} dataTestId="busy">
        <CardContent>x</CardContent>
      </Card>,
    );
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('busy'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lays the header out in MUI px and types its title and subtitle', () => {
    render(<CardHeader title="Título" subtitle="Subtítulo" avatar={null} action={null} />);

    expect(screen.getByTestId('card-header')).toHaveStyle({ padding: `${CARD_HEADER.padding}px` });
    expect(screen.getByTestId('card-title')).toHaveTextContent('Título');
    expect(screen.getByTestId('card-subtitle')).toHaveTextContent('Subtítulo');
    expect(cardTitleStyle(theme, false).fontSize).toBe(24);
    expect(cardTitleStyle(theme, true).fontSize).toBe(14);
    expect(cardSubtitleStyle(theme, false).fontSize).toBe(16);
    expect(cardSubtitleStyle(theme, false).color).toBe(theme.palette.text.secondary);
  });

  it('halves the content padding when dense and aligns the actions', () => {
    render(
      <>
        <CardContent dataTestId="roomy">a</CardContent>
        <CardContent dense dataTestId="tight">b</CardContent>
        <CardActions alignment="space-between" dataTestId="spread">c</CardActions>
        <CardActions disableSpacing dataTestId="tightActions">d</CardActions>
      </>,
    );

    expect(screen.getByTestId('roomy')).toHaveStyle({ padding: '16px' });
    expect(screen.getByTestId('tight')).toHaveStyle({ padding: '8px' });
    expect(screen.getByTestId('spread')).toHaveStyle({
      justifyContent: 'space-between',
      padding: `${CARD_ACTIONS.padding}px`,
      gap: `${CARD_ACTIONS.gap}px`,
    });
    expect(screen.getByTestId('tightActions')).not.toHaveStyle({ gap: `${CARD_ACTIONS.gap}px` });
  });

  it('sizes the media from a number, a numeric string or a percentage', () => {
    expect(mediaHeight(160)).toBe(160);
    expect(mediaHeight('200')).toBe(200);
    expect(mediaHeight('50%')).toBe('50%');

    render(<CardMedia image="https://example.test/a.png" title="Banner" />);
    expect(screen.getByTestId('card-media')).toHaveStyle({ height: '200px' });
  });

  it('reads the provider theme', () => {
    render(
      <UiProvider theme={{ mode: 'dark' }}>
        <Card dataTestId="dark">x</Card>
      </UiProvider>,
    );
    expect(screen.getByTestId('dark')).toHaveStyle({ backgroundColor: 'rgb(18, 18, 18)' });
  });
});
