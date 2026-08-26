import { styled } from '@mui/material/styles';
import React from 'react';

import { headingSx } from './Heading.styles';
import type { HeadingFlags } from './Heading.styles';
import type { HeadingProps } from './Heading.types';

const styledHeading = () =>
  styled('h1', {
    shouldForwardProp: (prop) =>
      !['customLevel', 'customColor', 'customWeight', 'gradient'].includes(prop as string),
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
 * Which tag each level renders. `display` is a size, not a rank, so it uses the
 * h1 element — the document still gets one level-one heading rather than an
 * unnamed tag outside the outline.
 */
const TAG_FOR_LEVEL: Record<string, keyof typeof STYLED_BY_TAG> = {
  display: 'h1',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
};

export const Heading = React.forwardRef<globalThis.HTMLHeadingElement, HeadingProps>(
  ({ level = 'h2', color = 'neutral', weight = 'bold', gradient = false, children, ...props }, ref) => {
    const Styled = STYLED_BY_TAG[TAG_FOR_LEVEL[level] ?? 'h2'];

    return (
      <Styled
        ref={ref}
        customLevel={level}
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
