import Box from '@mui/material/Box/index.js';
import Divider from '@mui/material/Divider/index.js';
import Paper from '@mui/material/Paper/index.js';
import Stack from '@mui/material/Stack/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { Heading } from './Heading';
import { COLOR_VALUES, HEADING_LEVELS } from '../../../tokens/scales';

const meta: Meta<typeof Heading> = {
  title: 'Typography/Heading',
  component: Heading,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A heading component with multiple levels, styles, and decorative options for creating clear visual hierarchy.',
      },
    },
  },
  tags: ['autodocs', 'component:Heading'],
  argTypes: {
    // Derived from the vocabulary, never spelled out: this control offered
    // `[1,2,3,4,5,6]` for a prop that takes `'h1'…'display'`, so every value it
    // documented was one the component rejects and `display` was undocumented.
    level: {
      control: { type: 'select' },
      options: HEADING_LEVELS,
      description: 'Semantic rank — the tag and the document outline',
    },
    size: {
      control: { type: 'select' },
      options: HEADING_LEVELS,
      description: 'Scale step to draw, when it differs from the rank (defaults to level)',
    },
    color: {
      control: { type: 'select' },
      options: COLOR_VALUES,
      description: 'Heading color',
    },
    weight: {
      control: { type: 'select' },
      options: ['light', 'normal', 'medium', 'semibold', 'bold'],
      description: 'Font weight',
    },
    gradient: {
      control: 'boolean',
      description: "Paint the glyphs with the colour's two-stop gradient",
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Default Heading',
    level: 'h1',
  },
};

export const HeadingLevels: Story = {
  render: () => (
    <Stack spacing={2}>
      <Heading level="h1">Heading Level 1 - Page Title</Heading>
      <Heading level="h2">Heading Level 2 - Section Title</Heading>
      <Heading level="h3">Heading Level 3 - Subsection</Heading>
      <Heading level="h4">Heading Level 4 - Sub-subsection</Heading>
      <Heading level="h5">Heading Level 5 - Minor Heading</Heading>
      <Heading level="h6">Heading Level 6 - Smallest Heading</Heading>
    </Stack>
  ),
};

// `variant="default" | "display" | "gradient" | "outlined"` never existed on
// `Heading` — the ONLY style knobs are `size` (draw at a different scale step
// than the rank), the `gradient` boolean, and (for a look this component has
// no name for, like an outline) plain `style`.
export const DisplayVariants: Story = {
  render: () => (
    <Stack spacing={3}>
      <Heading level="h1">Default Heading Style</Heading>
      <Heading level="h1" size="display">
        Display Heading Style
      </Heading>
      <Heading level="h1" gradient>
        Gradient Heading Style
      </Heading>
      <Heading level="h1" style={{ WebkitTextStroke: '1px currentColor', color: 'transparent' }}>
        Outlined Heading Style
      </Heading>
    </Stack>
  ),
};

export const ColoredHeadings: Story = {
  render: () => (
    <Stack spacing={2}>
      {/*
        Driven off COLOR_VALUES so the showcase cannot fall behind the
        vocabulary. It listed `textPrimary`, `textSecondary` and `inherit` —
        none of which the component has ever accepted. All three fell through
        `getColorFromTheme`'s old fallback and rendered as ordinary body text,
        so the story showed four headings in two colours while naming four.
      */}
      {COLOR_VALUES.map((color) => (
        <Heading key={color} level="h2" color={color}>
          {color.charAt(0).toUpperCase() + color.slice(1)} Color Heading
        </Heading>
      ))}
      {/* `inherit` was a prop that did nothing; the `style` is what painted this white. */}
      <Box sx={{ bgcolor: 'primary.main', p: 2 }}>
        <Heading level="h2" style={{ color: 'white' }}>
          Inherited Color Heading
        </Heading>
      </Box>
    </Stack>
  ),
};

// `decorated`/`underlined` never existed on `Heading` either — there is no
// built-in decoration beyond `gradient`. The look each example names is real
// CSS on the `style` prop `Heading` does forward (plain `HTMLAttributes`).
const DECORATION_STYLE = { borderBottom: '3px solid currentColor', paddingBottom: '0.25em' };
const UNDERLINE_STYLE = { textDecoration: 'underline' } as const;

export const DecoratedHeadings: Story = {
  render: () => (
    <Stack spacing={4}>
      <Heading level="h2" style={DECORATION_STYLE}>
        Heading with Decorative Elements
      </Heading>

      <Heading level="h2" style={UNDERLINE_STYLE}>
        Underlined Heading
      </Heading>

      <Heading level="h2" color="primary" style={{ ...DECORATION_STYLE, ...UNDERLINE_STYLE }}>
        Decorated and Underlined
      </Heading>

      <Heading level="h1" gradient style={DECORATION_STYLE}>
        Gradient with Decoration
      </Heading>
    </Stack>
  ),
};

export const AlignmentOptions: Story = {
  render: () => (
    <Stack spacing={3}>
      <Paper sx={{ p: 3 }}>
        <Heading level="h3" style={{ textAlign: 'left' }}>
          Left Aligned Heading
        </Heading>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Heading level="h3" style={{ textAlign: 'center' }}>
          Center Aligned Heading
        </Heading>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Heading level="h3" style={{ textAlign: 'right' }}>
          Right Aligned Heading
        </Heading>
      </Paper>
    </Stack>
  ),
};

export const FontWeights: Story = {
  render: () => (
    <Stack spacing={2}>
      <Heading level="h3" weight="light">
        Light Weight Heading
      </Heading>
      <Heading level="h3" weight="normal">
        Regular Weight Heading
      </Heading>
      <Heading level="h3" weight="medium">
        Medium Weight Heading
      </Heading>
      <Heading level="h3" weight="semibold">
        Semibold Weight Heading
      </Heading>
      <Heading level="h3" weight="bold">
        Bold Weight Heading
      </Heading>
      {/* `black` (900) is heavier than the vocabulary's own `bold` — real CSS
          on `style`, since `weight` itself only goes up to `bold`. */}
      <Heading level="h3" weight="bold" style={{ fontWeight: 900 }}>
        Black Weight Heading
      </Heading>
    </Stack>
  ),
};

export const PageHierarchy: Story = {
  render: () => (
    <Stack spacing={3}>
      <Heading level="h1" size="display" style={DECORATION_STYLE}>
        Main Page Title
      </Heading>

      <Divider />

      <Heading level="h2" color="primary">
        Section 1: Introduction
      </Heading>
      <Box sx={{ pl: 2 }}>
        <Heading level="h3">1.1 Overview</Heading>
        <Box sx={{ pl: 2 }}>
          <Heading level="h4" color="neutral">
            1.1.1 Background
          </Heading>
          <Heading level="h4" color="neutral">
            1.1.2 Objectives
          </Heading>
        </Box>
        <Heading level="h3">1.2 Scope</Heading>
      </Box>

      <Heading level="h2" color="primary">
        Section 2: Implementation
      </Heading>
      <Box sx={{ pl: 2 }}>
        <Heading level="h3">2.1 Technical Details</Heading>
        <Heading level="h3">2.2 Timeline</Heading>
      </Box>
    </Stack>
  ),
};

export const MarketingHeaders: Story = {
  render: () => (
    <Stack spacing={4} alignItems="center">
      <Heading
        level="h1"
        gradient
        weight="bold"
        style={{ textAlign: 'center', fontSize: 'clamp(2rem, 5vw, 3rem)' }}
      >
        Welcome to the Future
      </Heading>

      <Heading level="h2" color="neutral" weight="light" style={{ textAlign: 'center' }}>
        Innovate • Create • Transform
      </Heading>

      <Paper sx={{ p: 4, textAlign: 'center', maxWidth: 600 }}>
        <Heading level="h3" size="display" style={DECORATION_STYLE}>
          🚀 Launch Your Ideas
        </Heading>
        <Heading level="h4" color="neutral" weight="normal">
          Start building amazing products today
        </Heading>
      </Paper>
    </Stack>
  ),
};

export const BlogPostHeader: Story = {
  render: () => (
    <Stack spacing={2}>
      <Heading level="h6" color="primary" style={{ textTransform: 'uppercase' }}>
        Technology
      </Heading>
      <Heading level="h1" weight="bold">
        The Rise of Artificial Intelligence in Modern Web Development
      </Heading>
      <Heading level="h4" color="neutral" weight="normal">
        How AI is transforming the way we build and deploy applications
      </Heading>
      <Divider sx={{ my: 2 }} />
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <Heading level="h6" color="neutral">
          By Jane Doe
        </Heading>
        <Heading level="h6" color="neutral">
          •
        </Heading>
        <Heading level="h6" color="neutral">
          5 min read
        </Heading>
      </Box>
    </Stack>
  ),
};

// `Heading`'s own props (`style`, via plain `HTMLAttributes`) take ONE value,
// not a breakpoint map — so each responsive story below reads the theme
// itself, through `useMediaQuery`, and hands the component a single value
// already resolved for the current viewport.
const useHeadingBreakpoints = () => {
  const theme = useTheme();
  return {
    isSm: useMediaQuery(theme.breakpoints.up('sm')),
    isMd: useMediaQuery(theme.breakpoints.up('md')),
    isLg: useMediaQuery(theme.breakpoints.up('lg')),
  };
};

const ResponsiveHeadingsComponent = () => {
  const { isSm, isMd, isLg } = useHeadingBreakpoints();
  const fontSize = isLg ? '3rem' : isMd ? '2.5rem' : isSm ? '2rem' : '1.5rem';

  return (
    <Stack spacing={3}>
      <Heading level="h1" style={{ fontSize }}>
        Responsive Heading Size
      </Heading>

      {isMd && <Heading level="h2">Desktop Only Heading</Heading>}

      {!isMd && <Heading level="h2">Mobile Only Heading</Heading>}

      <Heading
        level="h3"
        color={isMd ? undefined : 'primary'}
        style={{ textAlign: isMd ? 'left' : 'center' }}
      >
        Adaptive Alignment and Color
      </Heading>
    </Stack>
  );
};

export const ResponsiveHeadings: Story = {
  render: () => <ResponsiveHeadingsComponent />,
};

// Required story exports for validation
export const AllVariants: Story = {
  render: () => (
    <Stack spacing={3}>
      <Heading level="h1">Default Variant</Heading>
      <Heading level="h1" size="display">
        Display Variant
      </Heading>
      <Heading level="h1" gradient>
        Gradient Variant
      </Heading>
      <Heading level="h1" style={{ WebkitTextStroke: '1px currentColor', color: 'transparent' }}>
        Outlined Variant
      </Heading>
    </Stack>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <Stack spacing={2}>
      <Heading level="h1">Level 1 Heading</Heading>
      <Heading level="h2">Level 2 Heading</Heading>
      <Heading level="h3">Level 3 Heading</Heading>
      <Heading level="h4">Level 4 Heading</Heading>
      <Heading level="h5">Level 5 Heading</Heading>
      <Heading level="h6">Level 6 Heading</Heading>
    </Stack>
  ),
};

export const AllStates: Story = {
  render: () => (
    <Stack spacing={2}>
      <Heading level="h2">Normal State</Heading>
      <Heading level="h2" color="primary">
        Primary Color
      </Heading>
      <Heading level="h2" color="secondary">
        Secondary Color
      </Heading>
      <Heading level="h2" color="neutral">
        Text Secondary
      </Heading>
      <Heading level="h2" style={DECORATION_STYLE}>
        Decorated State
      </Heading>
      <Heading level="h2" style={UNDERLINE_STYLE}>
        Underlined State
      </Heading>
    </Stack>
  ),
};

// `Heading` has no `component`/`as` override — every instance renders its own
// `h1`…`h6` tag, so "Focusable Heading Button" stays an `h3`, made focusable
// and interactive with `tabIndex` and real hover/focus state (`sx`'s
// `&:hover`/`&:focus` have no `style`-prop equivalent, so each is tracked with
// `useState` and resolved to a plain `style` object).
const HoverHeading = () => {
  const theme = useTheme();
  const [hovered, setHovered] = React.useState(false);

  return (
    <Heading
      level="h3"
      style={{
        cursor: 'pointer',
        color: hovered ? theme.palette.primary.main : undefined,
        transition: 'color 0.2s ease-in-out',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      Hover to Change Color
    </Heading>
  );
};

const FocusableHeading = () => {
  const theme = useTheme();
  const [focused, setFocused] = React.useState(false);

  return (
    <Heading
      level="h3"
      tabIndex={0}
      style={{
        cursor: 'pointer',
        outline: focused ? `2px solid ${theme.palette.primary.main}` : 'none',
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      Focusable Heading
    </Heading>
  );
};

export const InteractiveStates: Story = {
  render: () => (
    <Stack spacing={3}>
      <Heading level="h3">Static Heading</Heading>
      <HoverHeading />
      <FocusableHeading />
    </Stack>
  ),
};

const ResponsiveComponent = () => {
  const { isMd } = useHeadingBreakpoints();

  return (
    <Stack spacing={3}>
      <Heading
        level="h1"
        style={{ fontSize: isMd ? '2.5rem' : '1.5rem', textAlign: isMd ? 'left' : 'center' }}
      >
        Responsive Heading
      </Heading>
      {isMd && <Heading level="h2">Desktop Only</Heading>}
      {!isMd && <Heading level="h2">Mobile Only</Heading>}
    </Stack>
  );
};

export const Responsive: Story = {
  render: () => <ResponsiveComponent />,
};
