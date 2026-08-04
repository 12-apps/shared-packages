// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RbacProvider, useCan } from '../react/context';
import { Can } from '../react/can';

afterEach(cleanup);

function CanFlag({ permission }: { permission: string }) {
  const can = useCan();
  return <span>{can(permission) ? 'yes' : 'no'}</span>;
}

describe('RbacProvider + useCan', () => {
  it('returns true for a permission in the set', () => {
    render(
      <RbacProvider permissions={['posts:read', 'posts:write']}>
        <CanFlag permission="posts:write" />
      </RbacProvider>,
    );
    expect(screen.getByText('yes')).toBeTruthy();
  });

  it('returns false for a permission not in the set', () => {
    render(
      <RbacProvider permissions={['posts:read']}>
        <CanFlag permission="posts:write" />
      </RbacProvider>,
    );
    expect(screen.getByText('no')).toBeTruthy();
  });
});

describe('<Can>', () => {
  it('renders children when granted', () => {
    render(
      <RbacProvider permissions={['posts:write']}>
        <Can permission="posts:write">
          <span>editor</span>
        </Can>
      </RbacProvider>,
    );
    expect(screen.getByText('editor')).toBeTruthy();
  });

  it('renders the fallback when denied', () => {
    render(
      <RbacProvider permissions={['posts:read']}>
        <Can permission="posts:write" fallback={<span>denied</span>}>
          <span>editor</span>
        </Can>
      </RbacProvider>,
    );
    expect(screen.getByText('denied')).toBeTruthy();
    expect(screen.queryAllByText('editor')).toHaveLength(0);
  });

  it('renders nothing (null) by default when denied', () => {
    const { container } = render(
      <RbacProvider permissions={[]}>
        <Can permission="posts:write">
          <span>editor</span>
        </Can>
      </RbacProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
