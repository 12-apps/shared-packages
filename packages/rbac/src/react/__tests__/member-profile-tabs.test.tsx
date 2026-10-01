// @vitest-environment jsdom
/**
 * The member profile's tab row scrolls sideways (FUT-3147).
 *
 * Four tabs carry 541px of labels. At 320 and 390 the row clipped with
 * `overflow-x: hidden`, so "IA em nome do usuário" and "Itens criados" could
 * not be reached on a phone. jsdom does no layout, so what is asserted is the
 * switch that makes MUI scroll the row: its scroller takes `scrollableX`
 * instead of `fixed`.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemberProfile, type MemberProfileView } from '../member-profile';
import { PT_BR_RBAC_WEB_COPY } from '../pt-BR';

const MEMBER: MemberProfileView = {
  userId: 'u-ana',
  name: 'Ana',
  email: 'ana@example.com',
  image: null,
  roleLabels: ['Garçom'],
  memberSinceLabel: '01/10/2026',
  lastLoginLabel: '—',
};

describe('the member profile tabs', () => {
  it('scroll sideways instead of clipping the tabs that do not fit', () => {
    render(<MemberProfile member={MEMBER} copy={PT_BR_RBAC_WEB_COPY} initialTab="details" />);

    const tabs = screen.getByTestId('member-profile-tabs');
    expect(tabs.querySelectorAll('.MuiTabs-scrollableX').length).toBeGreaterThan(0);
    expect(tabs.querySelectorAll('.MuiTabs-fixed')).toHaveLength(0);
    // Every tab is still in the row, the last two included.
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });
});
