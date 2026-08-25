'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';

import type { MemberDetailWire, RbacApiClient } from './api';
import type { RbacWebCopy } from './copy';
import type { RbacLabels } from './labels';
import { MemberProfile, resolveProfileTab, type MemberProfileView } from './member-profile';

/**
 * The member profile's container: reads `GET /team/:userId` and hands the pure
 * view a fully formatted record.
 *
 * A 404 is a TERMINAL answer, not an error — the id is not a member of this
 * tenant, or the caller may not read the roster, and the endpoint deliberately
 * answers both the same way. It renders the not-found state rather than a
 * failure with a retry, because retrying cannot change either.
 */

export interface MemberScreenProps {
  api: RbacApiClient;
  labels: RbacLabels;
  copy: RbacWebCopy;
  /**
   * Format the two timestamps. REQUIRED: a date's presentation is a locale
   * decision and the host owns its locale, so an `Intl.DateTimeFormat` in here
   * would be this package quietly choosing one for every adopter.
   */
  formatters: {
    /** The join date — a date, no time. */
    date: (iso: string) => string;
    /** The last sign-in — a date AND a time; the reader wants both. */
    dateTime: (iso: string) => string;
  };
  breadcrumb?: readonly { label: string; href?: string }[];
  /**
   * The member to show. Omitted, it is read from the route's `userId` param —
   * the shape `manifest/web` declares. A host routing the screen some other way
   * passes it in rather than being forced into that param name.
   */
  userId?: string;
}

/** Distinguishes "not a member" from every other failure. */
function isNotFound(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  return status === 404 || (error instanceof Error && / 404 /.test(` ${error.message} `));
}

interface MemberState {
  member: MemberDetailWire | null;
  notFound: boolean;
  error: string | null;
}

function useMember(api: RbacApiClient, userId: string, loadFailed: string): {
  state: MemberState;
  loading: boolean;
  refresh: () => void;
} {
  const [state, setState] = useState<MemberState>({
    member: null,
    notFound: false,
    error: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    if (!userId) {
      setState({ member: null, notFound: true, error: null });
      return undefined;
    }
    api
      .getMember(userId)
      .then((member) => {
        if (live) setState({ member, notFound: false, error: null });
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setState(
          isNotFound(cause)
            ? { member: null, notFound: true, error: null }
            : {
                member: null,
                notFound: false,
                error: cause instanceof Error ? cause.message : loadFailed,
              },
        );
      });
    return () => {
      live = false;
    };
  }, [api, userId, nonce, loadFailed]);

  return {
    state,
    loading: state.member === null && !state.notFound && state.error === null,
    refresh: () => setNonce((value) => value + 1),
  };
}

/** Wire detail → the formatted view the pure profile renders. */
function toView(
  member: MemberDetailWire,
  labels: RbacLabels,
  formatters: MemberScreenProps['formatters'],
  emptyValue: string,
): MemberProfileView {
  return {
    userId: member.userId,
    name: member.name,
    email: member.email,
    image: member.image,
    roleLabel: labels.roleLabel(member.role),
    customRoles: member.customRoles,
    memberSinceLabel: formatters.date(member.memberSince),
    lastLoginLabel: member.lastLoginAt ? formatters.dateTime(member.lastLoginAt) : emptyValue,
  };
}

export function MemberScreen(props: MemberScreenProps): JSX.Element {
  const { api, labels, copy, formatters } = props;
  const words = copy.memberProfile;
  const routeParams = useParams();
  const [searchParams] = useSearchParams();
  const userId = props.userId ?? String(routeParams.userId ?? '');
  const { state, loading, refresh } = useMember(api, userId, words.loadFailed);

  if (loading) return <LoadingState dataTestId="member-profile-loading" />;
  if (state.notFound) {
    return (
      <EmptyState
        variant="minimal"
        title={words.notFoundTitle}
        description={words.notFoundBody}
        dataTestId="member-not-found"
      />
    );
  }
  if (state.error !== null || state.member === null) {
    return (
      <ErrorState
        title={words.loadFailed}
        message={state.error ?? words.loadFailed}
        retryLabel={words.retryAction}
        onRetry={refresh}
      />
    );
  }

  return (
    <MemberProfile
      member={toView(state.member, labels, formatters, words.emptyValue)}
      copy={copy}
      initialTab={resolveProfileTab(searchParams.get('tab'))}
      breadcrumb={props.breadcrumb}
    />
  );
}
