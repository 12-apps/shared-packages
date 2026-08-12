// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FUTURE_PAY_GOVERNANCE, FUTURE_PAY_PERMISSIONS } from '../../templates';

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
    const labels = createRbacLabels();
    expect(labels.permissionActionLabel('products:read:all')).toBe('Ver (todos)');
    expect(labels.permissionActionLabel('stock:move')).toBe('Movimentar');
  });

  it('falls back to the raw segment for an unknown permission', () => {
    expect(createRbacLabels().permissionActionLabel('foo:frobnicate')).toBe('frobnicate');
  });

  it('labels roles with custom names passing through', () => {
    const labels = createRbacLabels();
    expect(labels.roleLabel('WAITER')).toBe('Garçom');
    expect(labels.roleLabel('Barista')).toBe('Barista');
  });

  it('groups the catalog by domain', () => {
    const groups = groupPermissions(FUTURE_PAY_PERMISSIONS);
    const domains = groups.map((group) => group.domain);
    expect(domains).toContain('products');
    expect(domains).toContain('roles');
  });

  it('finds the SoD counterpart from the governance catalog', () => {
    for (const [a, b] of FUTURE_PAY_GOVERNANCE.sodPairs) {
      expect(sodCounterpart(FUTURE_PAY_GOVERNANCE, a)).toBe(b);
      expect(sodCounterpart(FUTURE_PAY_GOVERNANCE, b)).toBe(a);
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
  function mountForm() {
    const onSubmit = vi.fn();
    render(
      <RoleForm
        permissions={FUTURE_PAY_PERMISSIONS}
        governance={FUTURE_PAY_GOVERNANCE}
        labels={createRbacLabels()}
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
    const ownerMarker = (FUTURE_PAY_GOVERNANCE.ownerPermissions ?? [])[0];
    expect(ownerMarker).toBeDefined();
    const checkbox = screen
      .getByTestId(`perm-${ownerMarker as string}`)
      .querySelector('input') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('disables the SoD counterpart once one side is selected', () => {
    mountForm();
    const [a, b] = FUTURE_PAY_GOVERNANCE.sodPairs[0] as [string, string];
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
