import Box from '@mui/material/Box/index.js';
import Paper from '@mui/material/Paper/index.js';
import Stack from '@mui/material/Stack/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import { Text } from './Text';
import { COLOR_VALUES } from '../../../tokens/scales';

const meta: Meta<typeof Text> = {
  title: 'Typography/Text',
  component: Text,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A versatile text component with multiple variants, sizes, and styling options for consistent typography across your application.',
      },
    },
  },
  tags: ['autodocs', 'component:Text'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['body', 'heading', 'caption', 'code'],
      description: 'Text variant',
    },
    color: {
      control: { type: 'select' },
      options: COLOR_VALUES,
      description: 'Text color',
    },
    weight: {
      control: { type: 'select' },
      options: ['light', 'normal', 'medium', 'semibold', 'bold'],
      description: 'Font weight',
    },
    italic: {
      control: 'boolean',
      description: 'Italic text',
    },
    underline: {
      control: 'boolean',
      description: 'Underline text',
    },
    strikethrough: {
      control: 'boolean',
      description: 'Strikethrough text',
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'This is a default text component with standard styling.',
    variant: 'body',
  },
};

export const AllVariants: Story = {
  render: () => (
    <Stack spacing={2}>
      <Text as="p" variant="body" size="md">
        Body 1 - Main body text for primary content
      </Text>
      <Text as="p" variant="body" size="sm">
        Body 2 - Secondary body text for supporting content
      </Text>
      <Text as="p" variant="heading" size="md">
        Subtitle 1 - Prominent supporting text
      </Text>
      <Text as="p" variant="heading" size="sm">
        Subtitle 2 - Less prominent supporting text
      </Text>
      <Text variant="caption">Caption - Small descriptive text</Text>
      <Text variant="caption" style={{ textTransform: 'uppercase' }}>
        Overline - Small uppercase text
      </Text>
    </Stack>
  ),
};

export const ColorVariations: Story = {
  render: () => (
    <Stack spacing={2}>
      {/*
        Nine lines naming nine colours, of which four did not exist. `error`,
        `textPrimary`, `textSecondary` and `textDisabled` all missed the old
        colour map and hit its `|| text.primary` fallback — so "Error color
        text" rendered in plain body text, and the story that documents the
        colours was the thing least able to show they were broken.

        Driven off COLOR_VALUES now, so it lists what the component accepts and
        nothing else, and gains any colour the vocabulary gains.
      */}
      {COLOR_VALUES.map((color) => (
        <Text key={color} color={color}>
          {color.charAt(0).toUpperCase() + color.slice(1)} color text
        </Text>
      ))}
    </Stack>
  ),
};

export const FontWeights: Story = {
  render: () => (
    <Stack spacing={2}>
      <Text weight="light">Light weight text (300)</Text>
      <Text weight="normal">Regular weight text (400)</Text>
      <Text weight="medium">Medium weight text (500)</Text>
      <Text weight="semibold">Semibold weight text (600)</Text>
      <Text weight="bold">Bold weight text (700)</Text>
    </Stack>
  ),
};

export const TextAlignment: Story = {
  render: () => (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Text as="p" style={{ textAlign: 'left' }}>
          Left aligned text content
        </Text>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Text as="p" style={{ textAlign: 'center' }}>
          Center aligned text content
        </Text>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Text as="p" style={{ textAlign: 'right' }}>
          Right aligned text content
        </Text>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Text as="p" style={{ textAlign: 'justify' }}>
          Justified text content that spans multiple lines to demonstrate the justify alignment.
          This text will be evenly distributed across the full width of the container, creating
          uniform edges on both the left and right sides.
        </Text>
      </Paper>
    </Stack>
  ),
};

export const TextDecorations: Story = {
  render: () => (
    <Stack spacing={2}>
      <Text italic>Italic text for emphasis</Text>
      <Text underline>Underlined text for links or emphasis</Text>
      <Text strikethrough>Strikethrough text for deleted content</Text>
      <Text italic underline>
        Combined italic and underline
      </Text>
      <Text weight="bold" underline>
        Bold and underlined text
      </Text>
    </Stack>
  ),
};

export const TextTransformations: Story = {
  render: () => (
    <Stack spacing={2}>
      <Text as="p" style={{ textTransform: 'uppercase' }}>
        This text will be uppercase
      </Text>
      <Text as="p" style={{ textTransform: 'lowercase' }}>
        THIS TEXT WILL BE LOWERCASE
      </Text>
      <Text as="p" style={{ textTransform: 'capitalize' }}>
        this text will be capitalized
      </Text>
      <Text as="p" style={{ textTransform: 'none' }}>
        This Text Will Not Be Transformed
      </Text>
    </Stack>
  ),
};

export const TruncatedText: Story = {
  render: () => (
    <Stack spacing={2}>
      <Box sx={{ width: 300 }}>
        <Text as="p" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          This is a very long text that will be truncated with an ellipsis when it exceeds the
          container width
        </Text>
      </Box>
      <Box sx={{ width: 300 }}>
        <Text
          as="p"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          This is a multi-line text that will be truncated after two lines. Lorem ipsum dolor sit
          amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore
          magna aliqua.
        </Text>
      </Box>
    </Stack>
  ),
};

export const RealWorldExamples: Story = {
  render: () => (
    <Stack spacing={4}>
      <Paper sx={{ p: 3 }}>
        <Text as="p" variant="caption" color="primary" style={{ textTransform: 'uppercase' }}>
          New Feature
        </Text>
        <Text as="p" variant="heading" weight="bold" style={{ marginBottom: '0.35em' }}>
          Introducing Advanced Analytics
        </Text>
        <Text as="p" variant="body" size="sm" color="secondary">
          Get deeper insights into your data with our new analytics dashboard. Track metrics,
          visualize trends, and make data-driven decisions.
        </Text>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Text as="p" variant="caption" color="secondary">
          Posted 2 hours ago
        </Text>
        <Text as="p" variant="body" style={{ marginBottom: '0.35em' }}>
          Our team has been working hard to bring you the best experience possible.
        </Text>
        <Text as="p" variant="caption" italic color="secondary">
          By John Doe, Product Manager
        </Text>
      </Paper>

      <Paper sx={{ p: 3, bgcolor: 'error.light' }}>
        <Text as="p" variant="heading" size="sm" color="danger" weight="bold">
          ⚠️ Important Notice
        </Text>
        <Text as="p" variant="body" size="sm">
          System maintenance scheduled for tonight at 10 PM EST.
        </Text>
      </Paper>
    </Stack>
  ),
};

// `Text`'s own props (`style`, via plain `HTMLAttributes`) take ONE value, not
// a breakpoint map — so each responsive story below reads the theme itself,
// through `useMediaQuery`, and hands the component a single value already
// resolved for the current viewport.
const useTextBreakpoints = () => {
  const theme = useTheme();
  return {
    isSm: useMediaQuery(theme.breakpoints.up('sm')),
    isMd: useMediaQuery(theme.breakpoints.up('md')),
    isLg: useMediaQuery(theme.breakpoints.up('lg')),
  };
};

const ResponsiveTextComponent = () => {
  const { isSm, isMd, isLg } = useTextBreakpoints();
  const fontSize = isLg ? '1.25rem' : isMd ? '1.125rem' : isSm ? '1rem' : '0.875rem';

  return (
    <Stack spacing={2}>
      <Text as="p" style={{ fontSize, fontWeight: isMd ? 500 : 400 }}>
        This text adapts its size based on screen breakpoints
      </Text>
      {isSm && <Text as="p">This text is hidden on mobile devices</Text>}
      <Text as="p" style={{ textAlign: isMd ? 'left' : 'center' }}>
        This text is centered on mobile, left-aligned on desktop
      </Text>
    </Stack>
  );
};

export const ResponsiveText: Story = {
  render: () => <ResponsiveTextComponent />,
};

// Required exports for validation
export const AllSizes: Story = {
  render: () => (
    <Stack spacing={2}>
      <Text as="p" style={{ fontSize: '0.75rem' }}>Extra Small (12px)</Text>
      <Text as="p" style={{ fontSize: '0.875rem' }}>Small (14px)</Text>
      <Text as="p" style={{ fontSize: '1rem' }}>Medium (16px)</Text>
      <Text as="p" style={{ fontSize: '1.125rem' }}>Large (18px)</Text>
      <Text as="p" style={{ fontSize: '1.25rem' }}>Extra Large (20px)</Text>
      <Text as="p" style={{ fontSize: '1.5rem' }}>XXL (24px)</Text>
    </Stack>
  ),
};

export const AllStates: Story = {
  render: () => (
    <Stack spacing={2}>
      <Text>Default state</Text>
      <Text color="primary">Primary state</Text>
      <Text color="secondary">Secondary state</Text>
      <Text color="danger">Error state</Text>
      <Text color="warning">Warning state</Text>
      <Text color="success">Success state</Text>
      <Text italic>Italic state</Text>
      <Text underline>Underline state</Text>
      <Text strikethrough>Strikethrough state</Text>
    </Stack>
  ),
};

// `Text` forwards `style` (plain `HTMLAttributes`) but has no `sx`, so it
// cannot take a `&:hover`/`&:focus`/`&:active` pseudo-selector object. Each
// state below is real hover/focus/press state, tracked with `useState` and
// the matching DOM handlers, resolved to a plain `style` object.
const HoverFocusText = () => {
  const theme = useTheme();
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);

  return (
    <Text
      as="p"
      style={{
        cursor: 'pointer',
        color: hovered || focused ? theme.palette.primary.main : undefined,
        outline: focused ? `2px solid ${theme.palette.primary.main}` : 'none',
      }}
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      Hoverable and focusable text
    </Text>
  );
};

const HoverScaleText = () => {
  const theme = useTheme();
  const [hovered, setHovered] = React.useState(false);

  return (
    <Text
      as="p"
      style={{
        cursor: 'pointer',
        transition: 'all 0.2s',
        transform: hovered ? 'scale(1.05)' : undefined,
        color: hovered ? theme.palette.secondary.main : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      Text with hover effects
    </Text>
  );
};

const ActivePressText = () => {
  const theme = useTheme();
  const [active, setActive] = React.useState(false);

  return (
    <Text
      as="p"
      style={{ cursor: 'pointer', color: active ? theme.palette.success.main : undefined }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onMouseLeave={() => setActive(false)}
    >
      Text with active state
    </Text>
  );
};

export const InteractiveStates: Story = {
  render: () => (
    <Stack spacing={2}>
      <HoverFocusText />
      <HoverScaleText />
      <ActivePressText />
    </Stack>
  ),
};

const ResponsiveComponent = () => {
  const { isSm, isMd } = useTextBreakpoints();
  const fontSize = isMd ? '1.125rem' : isSm ? '1rem' : '0.875rem';

  return (
    <Stack spacing={2}>
      <Text
        as="p"
        style={{ fontSize, fontWeight: isMd ? 500 : 400, textAlign: isMd ? 'left' : 'center' }}
      >
        Responsive text sizing and alignment
      </Text>
      {!isMd && <Text as="p">Mobile-only text</Text>}
      {isMd && <Text as="p">Desktop-only text</Text>}
    </Stack>
  );
};

export const Responsive: Story = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  render: () => <ResponsiveComponent />,
};
