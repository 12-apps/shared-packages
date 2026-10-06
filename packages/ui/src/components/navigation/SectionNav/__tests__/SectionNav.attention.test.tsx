/**
 * A bar slot that something waits on without a count says "!" — money still
 * owed, a state to resolve — named for a screen reader by the copy's
 * `attention`; and the slot the viewer is on wears a pill behind its icon.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EN_US_SECTION_NAV_COPY } from '../../../../en-US.navigation';
import { SectionNav } from '../SectionNav';
import { menuCount, shownCount } from '../SectionNav.helpers';
import type { SectionNavDestination } from '../SectionNav.types';

afterEach(cleanup);

const icon = <svg data-testid="icon" />;

const DESTINATIONS: SectionNavDestination[] = [
  { id: 'summary', label: 'Summary', icon, onSelect: () => undefined, active: true },
  { id: 'payment', label: 'Payment', icon, onSelect: () => undefined, badge: '!' },
  { id: 'chat', label: 'Chat', icon, onSelect: () => undefined, badge: 2 },
];

function renderBar(): void {
  render(<SectionNav layout="bar" label="Order" destinations={DESTINATIONS} copy={EN_US_SECTION_NAV_COPY} dataTestId="nav" />);
}

describe('SectionNav attention badge', () => {
  it('says "!" with its own accessible name, beside an ordinary count', () => {
    renderBar();
    const attention = screen.getByTestId('nav-dest-payment-badge');
    expect(attention).toHaveTextContent('!');
    expect(screen.getByLabelText('Needs attention')).toBeInTheDocument();
    expect(screen.getByTestId('nav-dest-chat-badge')).toHaveTextContent('2');
  });

  it('is not a count: it never adds to a roll-up', () => {
    expect(shownCount('!')).toBeUndefined();
    expect(
      menuCount({ label: 'More', icon, title: 'More', groups: [{ id: 'g', entries: [{ id: 'a', label: 'A', icon, href: '/a', badge: '!' }] }] }),
    ).toBeUndefined();
  });

  it('draws a pill behind the lit slot icon only', () => {
    renderBar();
    const lit = screen.getByTestId('nav-dest-summary');
    expect(lit).toHaveAttribute('data-lit', 'true');
    expect(lit.querySelector('[data-slot-pill]')).not.toBeNull();
    expect(screen.getByTestId('nav-dest-payment')).not.toHaveAttribute('data-lit');
  });
});
