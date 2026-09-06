import { Avatar } from '@12-apps/ui/data-display/Avatar';
import { Badge } from '@12-apps/ui/data-display/Badge';
import { Chip } from '@12-apps/ui/data-display/Chip';
import { Progress } from '@12-apps/ui/data-display/Progress';
import { Icon } from '@12-apps/ui/icons';
import { Box } from '@12-apps/ui/layout/Box';
import { Skeleton } from '@12-apps/ui/layout/Skeleton';
import { Stack } from '@12-apps/ui/layout/Stack';
import { Text } from '@12-apps/ui/typography/Text';
import * as React from 'react';

import { Section } from './Section';

const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
const COLORS = ['primary', 'secondary', 'success', 'warning', 'info', 'danger', 'neutral'] as const;
const AVATAR_SIZES = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'] as const;
const AVATAR_STATUSES = ['online', 'offline', 'away', 'busy'] as const;
const BADGE_VARIANTS = [
  'default',
  'dot',
  'count',
  'gradient',
  'glass',
  'outline',
  'secondary',
  'destructive',
  'success',
  'warning',
] as const;
const PROGRESS_VARIANTS = ['linear', 'circular', 'segmented', 'gradient', 'glass'] as const;
const SKELETON_VARIANTS = ['text', 'circular', 'rectangular', 'wave'] as const;

export function ChipSection({ onCount }: { onCount: () => void }): React.JSX.Element {
  const [selected, setSelected] = React.useState(false);
  const [deleted, setDeleted] = React.useState(false);
  return (
    <Section title="Chip" testID="section-chip">
      <Stack direction="row" gap={1} wrap align="center">
        {SIZES.map((size) => (
          <Chip key={size} size={size} label={size} testID={`chip-size-${size}`} />
        ))}
      </Stack>
      <Stack direction="row" gap={1} wrap>
        {COLORS.map((color) => (
          <Chip key={color} color={color} label={color} testID={`chip-color-${color}`} />
        ))}
      </Stack>
      <Stack direction="row" gap={1} wrap>
        {COLORS.map((color) => (
          <Chip key={color} variant="outlined" color={color} label={color} testID={`chip-outlined-${color}`} />
        ))}
      </Stack>
      <Stack direction="row" gap={1} wrap align="center">
        <Chip label="Com ícone" icon={<Icon name="Search" size="sm" color="inherit" />} testID="chip-icon" />
        <Chip label="Com avatar" avatar={<Avatar size="xs" fallback="AB" />} testID="chip-avatar" />
        <Chip label="Desativado" disabled onClick={onCount} testID="chip-disabled" />
        <Chip
          label={selected ? 'Selecionado' : 'Selecionável'}
          selectable
          selected={selected}
          onClick={() => {
            setSelected((value) => !value);
            onCount();
          }}
          testID="chip-selectable"
        />
        {deleted ? null : (
          <Chip
            label="Removível"
            deletable
            onDelete={() => {
              setDeleted(true);
              onCount();
            }}
            testID="chip-deletable"
          />
        )}
      </Stack>
    </Section>
  );
}

export function AvatarSection(): React.JSX.Element {
  return (
    <Section title="Avatar" testID="section-avatar">
      <Stack direction="row" gap={2} wrap align="center">
        {AVATAR_SIZES.map((size) => (
          <Avatar key={size} size={size} fallback="TP" testID={`avatar-size-${size}`} />
        ))}
      </Stack>
      <Stack direction="row" gap={2} wrap align="center">
        {COLORS.map((color) => (
          <Avatar key={color} color={color} fallback="TP" testID={`avatar-color-${color}`} />
        ))}
      </Stack>
      <Stack direction="row" gap={2} wrap align="center">
        <Avatar variant="circle" fallback="CI" testID="avatar-circle" />
        <Avatar variant="square" fallback="SQ" testID="avatar-square" />
        <Avatar variant="rounded" fallback="RO" testID="avatar-rounded" />
        <Avatar icon={<Icon name="Person" size="md" color="inherit" />} testID="avatar-icon" />
        <Avatar bordered fallback="BO" testID="avatar-bordered" />
        <Avatar glow fallback="GL" testID="avatar-glow" />
        <Avatar pulse fallback="PU" testID="avatar-pulse" />
        <Avatar loading fallback="LO" testID="avatar-loading" />
      </Stack>
      <Stack direction="row" gap={2} wrap align="center">
        {AVATAR_STATUSES.map((status) => (
          <Avatar key={status} variant="status" status={status} fallback="ST" testID={`avatar-status-${status}`} />
        ))}
      </Stack>
    </Section>
  );
}

export function BadgeSection({ onCount }: { onCount: () => void }): React.JSX.Element {
  const [closed, setClosed] = React.useState(false);
  return (
    <Section title="Badge" testID="section-badge">
      <Stack direction="row" gap={2} wrap align="center">
        {SIZES.map((size) => (
          <Badge key={size} size={size} content={size === 'xs' ? 1 : 9} testID={`badge-size-${size}`}>
            <Box p={2} bg="paper" bordered radius="sm" />
          </Badge>
        ))}
      </Stack>
      <Stack direction="row" gap={2} wrap align="center">
        {BADGE_VARIANTS.map((variant) => (
          <Badge key={variant} variant={variant} content={3} testID={`badge-variant-${variant}`}>
            <Box p={2} bg="paper" bordered radius="sm" />
          </Badge>
        ))}
      </Stack>
      <Stack direction="row" gap={2} wrap align="center">
        {/* `max` and `showZero` are read only by `count`, on both renderers. */}
        <Badge variant="count" content={150} max={99} testID="badge-max">
          <Box p={2} bg="paper" bordered radius="sm" />
        </Badge>
        <Badge variant="count" content={0} testID="badge-zero-hidden">
          <Box p={2} bg="paper" bordered radius="sm" />
        </Badge>
        <Badge variant="count" content={0} showZero testID="badge-zero-shown">
          <Box p={2} bg="paper" bordered radius="sm" />
        </Badge>
        <Badge content={5} invisible testID="badge-invisible">
          <Box p={2} bg="paper" bordered radius="sm" />
        </Badge>
      </Stack>
      <Stack direction="row" gap={2} wrap align="center">
        <Badge content={7} position="top-left" testID="badge-top-left">
          <Box p={2} bg="paper" bordered radius="sm" />
        </Badge>
        <Badge content={7} position="bottom-right" testID="badge-bottom-right">
          <Box p={2} bg="paper" bordered radius="sm" />
        </Badge>
        <Badge content={7} position="bottom-left" testID="badge-bottom-left">
          <Box p={2} bg="paper" bordered radius="sm" />
        </Badge>
        {closed ? null : (
          <Badge
            content={2}
            closable
            onClose={() => {
              setClosed(true);
              onCount();
            }}
            testID="badge-closable"
          >
            <Box p={2} bg="paper" bordered radius="sm" />
          </Badge>
        )}
      </Stack>
    </Section>
  );
}

export function ProgressSection(): React.JSX.Element {
  return (
    <Section title="Progress" testID="section-progress">
      <Stack gap={2}>
        {SIZES.map((size) => (
          <Progress key={size} size={size} value={60} testID={`progress-size-${size}`} />
        ))}
      </Stack>
      <Stack direction="row" gap={2} wrap align="center">
        {PROGRESS_VARIANTS.map((variant) => (
          <Box key={variant} width={120}>
            <Progress variant={variant} value={45} testID={`progress-variant-${variant}`} />
          </Box>
        ))}
      </Stack>
      <Stack gap={2}>
        {COLORS.map((color) => (
          <Progress key={color} color={color} value={70} testID={`progress-color-${color}`} />
        ))}
      </Stack>
      <Stack gap={2}>
        <Progress value={35} showLabel testID="progress-labelled" />
        <Progress value={35} showLabel label="Enviando…" testID="progress-custom-label" />
        {/* No `value` at all: the bar animates instead of reporting a position. */}
        <Progress testID="progress-indeterminate" />
        <Progress variant="circular" testID="progress-circular-indeterminate" />
        <Progress variant="segmented" segments={5} value={60} testID="progress-segmented-five" />
        <Progress value={80} glow testID="progress-glow" />
        <Progress value={80} pulse testID="progress-pulse" />
      </Stack>
    </Section>
  );
}

export function SkeletonSection(): React.JSX.Element {
  return (
    <Section title="Skeleton" testID="section-skeleton">
      <Stack gap={2}>
        {SKELETON_VARIANTS.map((variant) => (
          <Skeleton key={variant} variant={variant} testID={`skeleton-variant-${variant}`} />
        ))}
      </Stack>
      <Stack direction="row" gap={2} wrap align="center">
        <Skeleton width={120} height={20} testID="skeleton-sized" />
        <Skeleton variant="circular" width={64} height={64} testID="skeleton-circle-lg" />
        <Skeleton width={120} height={20} borderRadius={12} testID="skeleton-radius" />
        <Skeleton width={120} height={20} animation={false} testID="skeleton-static" />
        <Skeleton width={120} height={20} intensity="low" testID="skeleton-low" />
        <Skeleton width={120} height={20} intensity="high" testID="skeleton-high" />
        <Skeleton width={120} height={20} shimmer testID="skeleton-shimmer" />
        <Skeleton width={120} height={20} glassmorphism testID="skeleton-glass" />
      </Stack>
      {/* `count` repeats the shape; `spacing` is in spacing units, not px. */}
      <Skeleton count={3} spacing={2} height={12} testID="skeleton-counted" />
      <Text size="sm">Três linhas acima, separadas por duas unidades.</Text>
    </Section>
  );
}
