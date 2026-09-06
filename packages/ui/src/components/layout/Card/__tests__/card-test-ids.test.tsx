/**
 * ONE TEST ID, THREE SPELLINGS — on the WEB half of `Card`.
 *
 * `Card.base.ts` puts `testID` in the contract both renderers honour, so
 * `<Card testID="x">` type-checks on the web too. Before this it type-checked
 * and did nothing useful: the id was never read, and the raw prop rode the rest
 * spread onto the DOM as an invalid `testid` attribute that React warns about.
 * These assert what `Button.tsx` has always done — resolve the id from any of
 * the three names, strip all three from what is spread.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Card, CardActions, CardContent, CardHeader, CardMedia } from '../index';

afterEach(cleanup);

describe('Card test ids (web)', () => {
  it('honours testID, dataTestId and data-testid on the card', () => {
    render(
      <>
        <Card testID="native">a</Card>
        <Card dataTestId="house">b</Card>
        <Card data-testid="raw">c</Card>
        <Card>d</Card>
      </>,
    );

    expect(screen.getByTestId('native')).toHaveTextContent('a');
    expect(screen.getByTestId('house')).toHaveTextContent('b');
    expect(screen.getByTestId('raw')).toHaveTextContent('c');
    expect(screen.getByTestId('card')).toHaveTextContent('d');
  });

  it('never leaks testID onto the DOM as an attribute', () => {
    render(
      <Card testID="cardnative">
        <CardHeader testID="hdrnative" title="t" />
        <CardContent testID="contentnative">body</CardContent>
        <CardActions testID="actionsnative">go</CardActions>
        <CardMedia testID="medianative" image="/x.png" />
      </Card>,
    );

    for (const id of ['cardnative', 'hdrnative', 'contentnative', 'actionsnative', 'medianative']) {
      expect(screen.getByTestId(id)).not.toHaveAttribute('testid');
    }
    expect(document.querySelectorAll('[testid]')).toHaveLength(0);
  });

  it('derives the header title and subtitle ids from the id the caller gave', () => {
    render(<CardHeader dataTestId="row" title="Título" subtitle="Subtítulo" />);

    expect(screen.getByTestId('row')).toBeInTheDocument();
    expect(screen.getByTestId('row-title')).toHaveTextContent('Título');
    expect(screen.getByTestId('row-subtitle')).toHaveTextContent('Subtítulo');
  });

  it('keeps the unnamed defaults every existing query relies on', () => {
    render(
      <Card>
        <CardHeader title="Título" subtitle="Subtítulo" />
        <CardContent>body</CardContent>
        <CardActions>go</CardActions>
        <CardMedia image="/x.png" />
      </Card>,
    );

    for (const id of [
      'card',
      'card-header',
      'card-title',
      'card-subtitle',
      'card-content',
      'card-actions',
      'card-media',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});
