import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Checkbox } from '../Checkbox/Checkbox';
import { Input } from '../Input/Input';
import { Select } from '../Select/Select';
import { Switch } from '../Switch/Switch';

/**
 * THREE SPELLINGS, ONE ID, AND THE OTHER TWO OFF THE DOM.
 *
 * The shared contract carries `testID` (React Native's name), `dataTestId`
 * (the house name) and `data-testid` (the DOM's), because a screen that ships
 * to both renderers should not have to know which one it is on. `Input` read
 * all three from the start; `Select`, `Switch` and `Checkbox` typed them and
 * then spread the two React does not recognise straight onto the element,
 * which React answers with `React does not recognize the 'testID' prop on a
 * DOM element` and which left a stray `testid="..."` attribute behind.
 *
 * `splitTestId` is what they all read now. These cases assert both halves of
 * it: the id is found under every spelling, and no spelling but the DOM's is
 * left on the element.
 */
const SPELLINGS = ['testID', 'dataTestId', 'data-testid'] as const;

const OPTIONS = [{ value: 'a', label: 'A' }];

const RENDERERS: Record<string, (props: Record<string, string>) => React.JSX.Element> = {
  Input: (props) => <Input label="Nome" {...props} />,
  Select: (props) => <Select options={OPTIONS} label="Estado" {...props} />,
  Switch: (props) => <Switch label="Ligado" {...props} />,
  Checkbox: (props) => <Checkbox label="Aceito" {...props} />,
};

describe('the form controls answer to every spelling of their test id', () => {
  for (const [name, renderOne] of Object.entries(RENDERERS)) {
    for (const spelling of SPELLINGS) {
      it(`${name} is found by ${spelling}`, () => {
        const { container } = render(renderOne({ [spelling]: 'field' }));
        expect(screen.getByTestId('field')).toBeInTheDocument();
        // The two React does not know never reach the DOM as attributes.
        expect(container.querySelector('[testid]')).toBeNull();
        expect(container.querySelector('[datatestid]')).toBeNull();
      });
    }
  }
});
