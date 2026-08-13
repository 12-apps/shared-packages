// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEMO_CATALOG } from '../../__tests__/demo-catalog';

import { createRbacLabels, groupPermissions, sodCounterpart } from '../labels';
import { RoleForm } from '../role-form';
import { splitRoleSelection } from '../team-screen';

/**
 * The web half's pure logic + the role form's affordances (12-13) — the
 * package port of what future-pay's admin asserted about the roles dialog:
 * submit unlocks only with a name AND a permission, the counter reflects the
 * composed set, and SoD/owner-marker checkboxes protect the composition.
 */

describe('labels', () => {
  it('translates a permission into pt-BR action + scope', () => {
    const labels = createRbacLabels(DEMO_CATALOG.labels);
    expect(labels.permissionActionLabel('products:read:all')).toBe('Ver (todos)');
    expect(labels.permissionActionLabel('stock:move')).toBe('Movimentar');
  });

  it('falls back to the raw segment for an unknown permission', () => {
    expect(
      createRbacLabels(DEMO_CATALOG.labels).permissionActionLabel('foo:frobnicate'),
    ).toBe('frobnicate');
  });

  it('labels roles with custom names passing through', () => {
    const labels = createRbacLabels(DEMO_CATALOG.labels);
    expect(labels.roleLabel('WAITER')).toBe('Garçom');
    expect(labels.roleLabel('Barista')).toBe('Barista');
  });

  it('groups the catalog by domain', () => {
    const groups = groupPermissions(DEMO_CATALOG.permissions);
    const domains = groups.map((group) => group.domain);
    expect(domains).toContain('products');
    expect(domains).toContain('roles');
  });

  it('finds the SoD counterpart from the governance catalog', () => {
    for (const [a, b] of DEMO_CATALOG.governance.sodPairs) {
      expect(sodCounterpart(DEMO_CATALOG.governance, a)).toBe(b);
      expect(sodCounterpart(DEMO_CATALOG.governance, b)).toBe(a);
    }
  });
});

describe('splitRoleSelection', () => {
  const system = new Set(['ADMIN', 'WAITER']);

  it('splits one system role + customs', () => {
    expect(splitRoleSelection(['WAITER', 'Barista'], system)).toEqual({
      base: 'WAITER',
      customRoles: ['Barista'],
    });
  });

  it('answers no base for zero or two system roles', () => {
    expect(splitRoleSelection(['Barista'], system).base).toBeNull();
    expect(splitRoleSelection(['ADMIN', 'WAITER'], system).base).toBeNull();
  });
});

describe('RoleForm', () => {
  // The form cases assert BEHAVIOR — unlock, owner-marker lock, SoD, trim —
  // not catalog completeness (the pure label/grouping tests above cover the
  // real catalog). Mounting all ~60 permissions made the first mount the
  // slowest case in the repo and timed a loaded CI runner out at the 5s
  // default (12-13). The form renders the same affordances over any catalog,
  // so mount exactly the permissions the four cases touch.
  const SOD_PAIR = DEMO_CATALOG.governance.sodPairs[0] as [string, string];
  const OWNER_MARKER = (DEMO_CATALOG.governance.ownerPermissions ?? [])[0] as string;
  const FORM_PERMISSIONS = {
    list: DEMO_CATALOG.permissions.list.filter((permission) =>
      ['stock:read', OWNER_MARKER, ...SOD_PAIR].includes(permission),
    ),
    kind: DEMO_CATALOG.permissions.kind,
  };

  function mountForm() {
    const onSubmit = vi.fn();
    render(
      <RoleForm
        permissions={FORM_PERMISSIONS}
        governance={DEMO_CATALOG.governance}
        labels={createRbacLabels(DEMO_CATALOG.labels)}
        initial={null}
        busy={false}
        error={null}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    );
    return { onSubmit };
  }

  it('unlocks submit only with a name AND at least one permission', () => {
    mountForm();
    const submit = screen.getByTestId('role-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('role-name'), {
      target: { value: 'Papel de teste' },
    });
    expect(submit.disabled).toBe(true);

    const stockRead = screen.getByTestId('perm-stock:read').querySelector('input');
    expect(stockRead).not.toBeNull();
    fireEvent.click(stockRead as HTMLInputElement);
    expect(screen.getByText('Permissões (1 selecionada)')).toBeTruthy();
    expect(submit.disabled).toBe(false);
  });

  it('never lets an owner-marker permission be composed in', () => {
    mountForm();
    const ownerMarker = (DEMO_CATALOG.governance.ownerPermissions ?? [])[0];
    expect(ownerMarker).toBeDefined();
    const checkbox = screen
      .getByTestId(`perm-${ownerMarker as string}`)
      .querySelector('input') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('disables the SoD counterpart once one side is selected', () => {
    mountForm();
    const [a, b] = DEMO_CATALOG.governance.sodPairs[0] as [string, string];
    const first = screen.getByTestId(`perm-${a}`).querySelector('input');
    fireEvent.click(first as HTMLInputElement);
    const counterpart = screen
      .getByTestId(`perm-${b}`)
      .querySelector('input') as HTMLInputElement;
    expect(counterpart.disabled).toBe(true);
  });

  it('submits the trimmed composition', () => {
    const { onSubmit } = mountForm();
    fireEvent.change(screen.getByTestId('role-name'), {
      target: { value: '  Barista  ' },
    });
    fireEvent.click(
      screen.getByTestId('perm-stock:read').querySelector('input') as HTMLInputElement,
    );
    fireEvent.click(screen.getByTestId('role-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Barista',
      description: null,
      permissions: ['stock:read'],
    });
  });
});
