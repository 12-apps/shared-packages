import { styled } from '@mui/material/styles/index.js';
import React from 'react';

import { HEADING_DEFAULT_COLOR, HEADING_DEFAULT_LEVEL, HEADING_DEFAULT_WEIGHT, HEADING_RANK, stepOf } from './Heading.metrics';
import { headingSx } from './Heading.styles';
import type { HeadingFlags } from './Heading.styles';
import type { HeadingProps } from './Heading.types';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';

const styledHeading = () =>
  styled('h1', {
    shouldForwardProp: (prop) =>
      !['customSize', 'customColor', 'customWeight', 'gradient'].includes(prop as string),
  })<HeadingFlags>(({ theme, ...flags }) => ({ ...headingSx(theme, flags) }));

/**
 * One styled component per tag. They share a style function but must be
 * separate components, since `withComponent` fixes the element at definition
 * time — a single component switching tags per render would remount the text.
 */
const STYLED_BY_TAG = {
  h1: styledHeading().withComponent('h1'),
  h2: styledHeading().withComponent('h2'),
  h3: styledHeading().withComponent('h3'),
  h4: styledHeading().withComponent('h4'),
  h5: styledHeading().withComponent('h5'),
  h6: styledHeading().withComponent('h6'),
} as const;

/**
 * The rank and the size were ALREADY independent in here — the tag and the
 * `customSize` are two separate derivations from one prop. The component just
 * never let a caller set them apart, so anyone who needed an `h1` at a smaller
 * size had to reach around the component and restyle it. `size` is that seam,
 * exposed: it defaults to `level`, so nothing that exists renders differently.
 *
 * Which tag each level renders is `HEADING_RANK` in the shared metrics (the
 * native `Heading` announces the same number as `aria-level`); `display` is a
 * size, not a rank, so it uses the h1 element.
 */
export const Heading = React.forwardRef<globalThis.HTMLHeadingElement, HeadingProps>(
  (
    {
      level = HEADING_DEFAULT_LEVEL,
      size,
      color = HEADING_DEFAULT_COLOR,
      weight = HEADING_DEFAULT_WEIGHT,
      gradient = false,
      children,
      ...others
    },
    ref,
  ) => {
    const Styled = STYLED_BY_TAG[`h${HEADING_RANK[stepOf(level)]}`];
    // `testID` and `dataTestId` are the shared contract's spellings; the DOM
    // wants `data-testid`, and must not see the other two as attributes.
    const testId = resolveTestId(others);
    const props = withoutTestIdProps(others);

    return (
      <Styled
        ref={ref}
        data-testid={testId}
        customSize={size ?? level}
        customColor={color}
        customWeight={weight}
        gradient={gradient}
        {...props}
      >
        {children}
      </Styled>
    );
  },
);

Heading.displayName = 'Heading';
