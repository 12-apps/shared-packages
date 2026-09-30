import Box from '@mui/material/Box/index.js';
import Card from '@mui/material/Card/index.js';
import CardContent from '@mui/material/CardContent/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import { styled } from '@mui/material/styles/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Separator } from './Separator';
import { SIZE_VALUES } from '../../../tokens/scales';

// `Separator` only forwards `className` — it has no `sx` prop — so per-case
// custom CSS (hover, an animated gradient, breakpoint-varying width/weight)
// goes through `styled(Separator)`, the MUI-documented way to attach extra
// CSS to a component that exposes only `className`.
const HoverSeparator = styled(Separator)({
  '&:hover': {
    opacity: 0.7,
    transition: 'opacity 0.2s ease-in-out',
  },
});

const AnimatedGradientSeparator = styled(Separator)({
  position: 'relative',
  overflow: 'hidden',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: '-100%',
    width: '100%',
    height: '100%',
    background: 'linear-gradient(90deg, transparent, rgba(25, 118, 210, 0.3), transparent)',
    animation: 'shimmer 2s infinite',
  },
  '@keyframes shimmer': {
    '0%': { left: '-100%' },
    '100%': { left: '100%' },
  },
});

const ResponsiveWidthSeparator = styled(Separator)(({ theme }) => ({
  width: '100%',
  marginLeft: 'auto',
  marginRight: 'auto',
  [theme.breakpoints.up('sm')]: { width: '80%' },
  [theme.breakpoints.up('md')]: { width: '60%' },
  [theme.breakpoints.up('lg')]: { width: '40%' },
}));

const ResponsiveThicknessSeparator = styled(Separator)(({ theme }) => ({
  borderTopWidth: '1px',
  [theme.breakpoints.up('sm')]: { borderTopWidth: '2px' },
  [theme.breakpoints.up('md')]: { borderTopWidth: '3px' },
  [theme.breakpoints.up('lg')]: { borderTopWidth: '4px' },
}));

const ResponsiveMarginSeparator = styled(Separator)(({ theme }) => ({
  margin: '8px 0',
  [theme.breakpoints.up('sm')]: { margin: '16px 0' },
  [theme.breakpoints.up('md')]: { margin: '24px 0' },
  [theme.breakpoints.up('lg')]: { margin: '32px 0' },
}));

const ResponsiveOrientationSeparator = styled(Separator)(({ theme }) => ({
  transform: 'none',
  height: '1px',
  width: '100%',
  [theme.breakpoints.up('md')]: {
    transform: 'rotate(90deg)',
    height: '60px',
    width: '1px',
  },
}));

const meta: Meta<typeof Separator> = {
  title: 'Layout/Separator',
  component: Separator,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs', 'component:Separator'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['solid', 'dashed', 'dotted', 'gradient'],
    },
    orientation: {
      control: { type: 'select' },
      options: ['horizontal', 'vertical'],
    },
    size: {
      control: { type: 'select' },
      options: SIZE_VALUES,
    },
    color: {
      control: { type: 'color' },
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    variant: 'solid',
    orientation: 'horizontal',
    size: 'md',
  },
  render: (args) => (
    <Box sx={{ width: '100%' }}>
      <Typography>Content above separator</Typography>
      <Separator {...args} />
      <Typography>Content below separator</Typography>
    </Box>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Solid Separator
        </Typography>
        <Typography>Content before</Typography>
        <Separator variant="solid" />
        <Typography>Content after</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Dashed Separator
        </Typography>
        <Typography>Content before</Typography>
        <Separator variant="dashed" />
        <Typography>Content after</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Dotted Separator
        </Typography>
        <Typography>Content before</Typography>
        <Separator variant="dotted" />
        <Typography>Content after</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Gradient Separator
        </Typography>
        <Typography>Content before</Typography>
        <Separator variant="gradient" />
        <Typography>Content after</Typography>
      </Box>
    </Stack>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <Stack spacing={4}>
      {(SIZE_VALUES).map((size) => (
        <Box key={size}>
          <Typography variant="h6" gutterBottom>
            {size.toUpperCase()} Size
          </Typography>
          <Typography>Content before</Typography>
          <Separator size={size} />
          <Typography>Content after</Typography>
        </Box>
      ))}
    </Stack>
  ),
};

export const VerticalSeparators: Story = {
  render: () => (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Vertical Separators
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', height: 100 }}>
          <Typography>Left</Typography>
          <Separator orientation="vertical" />
          <Typography>Middle</Typography>
          <Separator orientation="vertical" variant="dashed" />
          <Typography>Right</Typography>
        </Box>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Different Vertical Sizes
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, height: 80 }}>
          <Typography>XS</Typography>
          <Separator orientation="vertical" size="xs" />
          <Typography>SM</Typography>
          <Separator orientation="vertical" size="sm" />
          <Typography>MD</Typography>
          <Separator orientation="vertical" size="md" />
          <Typography>LG</Typography>
          <Separator orientation="vertical" size="lg" />
          <Typography>XL</Typography>
          <Separator orientation="vertical" size="xl" />
          <Typography>End</Typography>
        </Box>
      </Box>
    </Stack>
  ),
};

export const WithText: Story = {
  render: () => (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Horizontal Separator with Text
        </Typography>
        <Typography>Before separator</Typography>
        <Separator>OR</Separator>
        <Typography>After separator</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Different Variants with Text
        </Typography>
        <Typography>Section 1</Typography>
        <Separator variant="dashed">Section Break</Separator>
        <Typography>Section 2</Typography>
        <Separator variant="gradient">Gradient Divider</Separator>
        <Typography>Section 3</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Vertical Separator with Text
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', height: 120 }}>
          <Typography>Left Content</Typography>
          <Separator orientation="vertical">OR</Separator>
          <Typography>Right Content</Typography>
        </Box>
      </Box>
    </Stack>
  ),
};

export const CardExample: Story = {
  render: () => (
    <Card sx={{ maxWidth: 400 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          User Profile
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Basic information about the user account and preferences.
        </Typography>

        <Separator margin={16}>Account Details</Separator>

        <Typography variant="body2" paragraph>
          Name: John Doe
          <br />
          Email: john.doe@example.com
          <br />
          Role: Administrator
        </Typography>

        <Separator variant="dashed" margin={16}>
          Settings
        </Separator>

        <Typography variant="body2" paragraph>
          Theme: Dark Mode
          <br />
          Language: English
          <br />
          Timezone: UTC-5
        </Typography>

        <Separator variant="gradient" margin={16} />

        <Typography variant="caption" color="text.secondary">
          Last updated: March 15, 2024
        </Typography>
      </CardContent>
    </Card>
  ),
};

export const FormExample: Story = {
  render: () => (
    <Box sx={{ maxWidth: 500, mx: 'auto' }}>
      <Typography variant="h5" gutterBottom>
        Contact Form
      </Typography>

      <Typography variant="body1" paragraph>
        Please fill out the form below and we&apos;ll get back to you.
      </Typography>

      <Separator>Personal Information</Separator>

      <Box sx={{ my: 3 }}>
        <Typography variant="body2" gutterBottom>
          This section contains fields for your personal details.
        </Typography>
      </Box>

      <Separator variant="dashed">Contact Details</Separator>

      <Box sx={{ my: 3 }}>
        <Typography variant="body2" gutterBottom>
          Please provide your contact information.
        </Typography>
      </Box>

      <Separator variant="gradient">Message</Separator>

      <Box sx={{ my: 3 }}>
        <Typography variant="body2" gutterBottom>
          Tell us how we can help you.
        </Typography>
      </Box>
    </Box>
  ),
};

export const CustomColors: Story = {
  render: () => (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Custom Colors
        </Typography>
        <Typography>Primary color</Typography>
        <Separator color="#1976d2" />
        <Typography>Secondary color</Typography>
        <Separator color="#dc004e" />
        <Typography>Success color</Typography>
        <Separator color="#2e7d32" variant="dashed" />
        <Typography>Warning color</Typography>
        <Separator color="#ed6c02" variant="dotted" />
      </Box>
    </Stack>
  ),
};

export const CustomLengthAndMargin: Story = {
  render: () => (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Custom Length
        </Typography>
        <Typography>50% width separator</Typography>
        <Separator length="50%" />
        <Typography>200px width separator</Typography>
        <Separator length="200px" />
        <Typography>Full width (default)</Typography>
        <Separator />
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Custom Margin
        </Typography>
        <Typography>No margin</Typography>
        <Separator margin={0} />
        <Typography>Large margin (32px)</Typography>
        <Separator margin="32px" />
        <Typography>Small margin (4px)</Typography>
        <Separator margin="4px" />
      </Box>
    </Stack>
  ),
};

export const EdgeCases: Story = {
  render: () => (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Long Text Content
        </Typography>
        <Typography>Before separator</Typography>
        <Separator>
          This is a very long text that should be handled gracefully by the separator component
        </Separator>
        <Typography>After separator</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Empty Text Content
        </Typography>
        <Typography>Before separator</Typography>
        <Separator>{''}</Separator>
        <Typography>After separator</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Nested Content
        </Typography>
        <Typography>Complex content</Typography>
        <Separator>
          <Box component="span" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
            Formatted Text
          </Box>
        </Separator>
        <Typography>More content</Typography>
      </Box>
    </Stack>
  ),
};

export const AllStates: Story = {
  render: () => (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Default State
        </Typography>
        <Typography>Content above</Typography>
        <Separator />
        <Typography>Content below</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          With Text State
        </Typography>
        <Typography>Content above</Typography>
        <Separator>Section Break</Separator>
        <Typography>Content below</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Custom Color State
        </Typography>
        <Typography>Content above</Typography>
        <Separator color="#1976d2" />
        <Typography>Content below</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Custom Length State
        </Typography>
        <Typography>Content above</Typography>
        <Separator length="50%" />
        <Typography>Content below</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Custom Margin State
        </Typography>
        <Typography>Content above</Typography>
        <Separator margin={32} />
        <Typography>Content below</Typography>
      </Box>
    </Stack>
  ),
};

export const InteractiveStates: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`Separator` has no `sx` prop and forwards no interactive attribute — it only ever renders a plain `<div role="separator">`. Custom CSS goes through `styled(Separator)`; a focus ring goes on a wrapping element the caller controls, not on the separator itself.',
      },
    },
  },
  render: () => (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Hover Effect (Custom Color)
        </Typography>
        <Typography>Hover over the separator below</Typography>
        <HoverSeparator color="#1976d2" />
        <Typography>Content after</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Focus State (For Accessibility)
        </Typography>
        <Typography>
          `Separator` takes no `tabIndex` or other interactive prop — it is
          decorative. Tab to the separator&apos;s WRAPPER below to see the
          focus ring a caller places around it.
        </Typography>
        <Box
          tabIndex={0}
          sx={{
            display: 'inline-block',
            width: '100%',
            borderRadius: 1,
            '&:focus-visible': {
              outline: '2px solid #1976d2',
              outlineOffset: '2px',
            },
          }}
        >
          <Separator />
        </Box>
        <Typography>Content after</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Animated Gradient
        </Typography>
        <Typography>Animated gradient separator</Typography>
        <AnimatedGradientSeparator variant="gradient" />
        <Typography>Content after</Typography>
      </Box>
    </Stack>
  ),
};

export const Responsive: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`Separator` has no `sx` prop, so none of its own props take a breakpoint map either — every breakpoint-varying example here goes through `styled(Separator)` instead.',
      },
    },
  },
  render: () => (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h6" gutterBottom>
          Responsive Width
        </Typography>
        <Typography>This separator adjusts to container width</Typography>
        <ResponsiveWidthSeparator />
        <Typography>Content after</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Responsive Size
        </Typography>
        <Typography>Separator thickness changes with screen size</Typography>
        <ResponsiveThicknessSeparator />
        <Typography>Content after</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Responsive Margin
        </Typography>
        <Typography>Separator margins adapt to screen size</Typography>
        <ResponsiveMarginSeparator />
        <Typography>Content after</Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Responsive Orientation
        </Typography>
        <Typography>Changes from horizontal to vertical on mobile</Typography>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: 'center',
            height: { xs: 'auto', md: 60 },
            gap: 2,
          }}
        >
          <Typography>Left Content</Typography>
          <ResponsiveOrientationSeparator orientation="horizontal" />
          <Typography>Right Content</Typography>
        </Box>
      </Box>
    </Stack>
  ),
};
