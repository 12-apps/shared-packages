'use client';

import { useState, type JSX, type SyntheticEvent } from 'react';

import { Avatar } from '@12-apps/ui/data-display/Avatar';
import { Chip } from '@12-apps/ui/data-display/Chip';
import { DescriptionItem } from '@12-apps/ui/data-display/DescriptionItem';
import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { Card } from '@12-apps/ui/layout/Card';
import { Dashboard } from '@12-apps/ui/layout/Dashboard';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Tabs } from '@12-apps/ui/navigation/Tabs';
import { Text } from '@12-apps/ui/typography/Text';

import type { MemberProfileCopy, RbacWebCopy } from './copy';

/**
 * One member's profile, pre-formatted by its container so this stays a pure
 * view. Both dates arrive as STRINGS: formatting a date is a locale decision
 * and the host owns its locale, so a `Intl.DateTimeFormat` in here would be
 * this package choosing one.
 */
export interface MemberProfileView {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  /** The base tenant role, already mapped to its label. */
  roleLabel: string;
  /** Additive tenant custom roles, shown by their own names. */
  customRoles: string[];
  memberSinceLabel: string;
  /** The last sign-in, or the copy's empty value when none was recorded. */
  lastLoginLabel: string;
}

/** The profile tabs. The details tab ships; the rest are declared placeholders. */
const TAB_IDS = ['details', 'actions', 'ai', 'items'] as const;
export type ProfileTab = (typeof TAB_IDS)[number];

const isProfileTab = (value: string): value is ProfileTab =>
  (TAB_IDS as readonly string[]).includes(value);

/** Resolve a raw `?tab=` value to a known tab, defaulting to the details tab. */
export function resolveProfileTab(raw: string | null): ProfileTab {
  return raw && isProfileTab(raw) ? raw : 'details';
}

/** Initials for the avatar fallback: first letters of the name, else the e-mail. */
function initials(name: string | null, email: string): string {
  const source = (name ?? email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? source;
  const last = parts[parts.length - 1] ?? first;
  const letters = parts.length > 1 ? `${first[0] ?? ''}${last[0] ?? ''}` : source.slice(0, 2);
  return letters.toUpperCase();
}

/** The details tab — the identity header plus the read-only access metadata. */
function DetailsTab({
  member,
  copy,
}: {
  member: MemberProfileView;
  copy: MemberProfileCopy;
}): JSX.Element {
  return (
    <Card sx={{ p: 3 }} data-testid="member-details-tab">
      <Stack spacing={3}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar
            size="lg"
            src={member.image ?? undefined}
            fallback={initials(member.name, member.email)}
            alt=""
            aria-hidden="true"
          />
          <Box sx={{ minWidth: 0 }}>
            <Text as="p" size="lg" style={{ fontWeight: 600 }}>
              {member.name ?? member.email}
            </Text>
            <Text as="p" size="sm" color="secondary">
              {member.email}
            </Text>
          </Box>
        </Stack>

        <Box
          sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}
        >
          <DescriptionItem
            label={copy.fields.baseRole}
            value={member.roleLabel}
            data-testid="member-role"
          />
          <DescriptionItem
            label={copy.fields.customRoles}
            data-testid="member-custom-roles"
            value={
              member.customRoles.length > 0 ? (
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  {member.customRoles.map((role) => (
                    <Chip key={role} label={role} size="sm" variant="outlined" />
                  ))}
                </Stack>
              ) : (
                copy.emptyValue
              )
            }
          />
          <DescriptionItem
            label={copy.fields.memberSince}
            value={member.memberSinceLabel}
            data-testid="member-since"
          />
          <DescriptionItem
            label={copy.fields.lastLogin}
            value={member.lastLoginLabel}
            data-testid="member-last-login"
          />
        </Box>
      </Stack>
    </Card>
  );
}

/** A tab whose feature has not shipped. Declared, so a host can decide on it. */
function ComingSoon({
  title,
  body,
  testId,
}: {
  title: string;
  body: string;
  testId: string;
}): JSX.Element {
  return <EmptyState variant="minimal" title={title} description={body} dataTestId={testId} />;
}

/**
 * A member's tabbed profile. The active tab is mirrored to `?tab=` so the view
 * is shareable and survives a refresh — written with `history.replaceState`
 * rather than a router navigation because every tab body is client-rendered,
 * and a route change would needlessly re-run the read.
 */
export function MemberProfile({
  member,
  copy,
  initialTab,
  breadcrumb,
}: {
  member: MemberProfileView;
  copy: RbacWebCopy;
  /** The tab to open on first render, resolved from `?tab=` by the container. */
  initialTab: ProfileTab;
  breadcrumb?: readonly { label: string; href?: string }[];
}): JSX.Element {
  const words = copy.memberProfile;
  const [active, setActive] = useState<ProfileTab>(initialTab);

  function handleChange(_event: SyntheticEvent, next: string): void {
    if (!isProfileTab(next)) return;
    setActive(next);
    const params = new URLSearchParams(window.location.search);
    if (next === 'details') params.delete('tab');
    else params.set('tab', next);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }

  const items = [
    { id: 'details', label: words.tabs.details, content: <DetailsTab member={member} copy={words} /> },
    {
      id: 'actions',
      label: words.tabs.actions,
      content: <ComingSoon title={words.tabs.actions} body={words.comingSoon} testId="member-actions-tab" />,
    },
    {
      id: 'ai',
      label: words.tabs.ai,
      content: <ComingSoon title={words.tabs.ai} body={words.comingSoon} testId="member-ai-tab" />,
    },
    {
      id: 'items',
      label: words.tabs.items,
      content: <ComingSoon title={words.tabs.items} body={words.comingSoon} testId="member-items-tab" />,
    },
  ];

  const title = member.name ?? member.email;
  return (
    <Dashboard testIdPrefix="member-dashboard">
      {breadcrumb && <Dashboard.Breadcrumb items={[...breadcrumb, { label: title }]} />}
      <Dashboard.Header title={title} />
      <Dashboard.Body>
        <Tabs
          closeTabLabel={copy.closeLabel}
          items={items}
          value={active}
          onChange={handleChange}
          variant="underline"
          dataTestId="member-profile-tabs"
        />
      </Dashboard.Body>
    </Dashboard>
  );
}
