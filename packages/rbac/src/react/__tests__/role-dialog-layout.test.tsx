// @vitest-environment jsdom
/**
 * The role-edit popup's body is the paper's own child.
 *
 * `RoleEditDialog` hands `<Dialog>` a `<RoleEditBody />`, and that component
 * renders the `DialogContent`. Until @12-apps/ui settled the question in the DOM
 * rather than on the element type, the dialog could not tell — it saw a
 * component, decided the consumer was passing raw children, and wrapped them in
 * its 24px padding box. Two consequences, both visible here:
 *
 *  - the body was indented 48px, its own 24px inside the wrapper's;
 *  - the `DialogContent` (`overflow-y: auto`) stopped being a direct child of
 *    the paper's flex column, so it could not be the element that scrolls. On a
 *    tenant with enough custom roles the checklist pushed Cancelar/Salvar past
 *    the bottom of the paper instead of scrolling under them.
 *
 * Nothing in THIS package changed to fix it. That is the point of the test: the
 * call site is written the way anyone would write it, and it is the library that
 * had to stop punishing the refactor.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

import { createRbacLabels } from '../labels';
import { PT_BR_RBAC_WEB_COPY } from '../pt-BR';
import { RoleEditDialog } from '../team-role-dialog';
import type { MemberWithRoles } from '../team-role-dialog';

const MEMBER: MemberWithRoles = {
  userId: 'u-1',
  role: 'MANAGER',
  email: 'alguem@example.com',
  name: 'Alguém',
  image: null,
  active: true,
  status: 'ENABLED',
  customRoles: [],
};

function open(): JSX.Element {
  return (
    <RoleEditDialog
      member={MEMBER}
      systemRoles={['OWNER', 'MANAGER', 'WAITER']}
      availableCustomRoles={['Caixa']}
      labels={createRbacLabels()}
      copy={PT_BR_RBAC_WEB_COPY.teamRoleDialog}
      busy={false}
      error={null}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />
  );
}

describe('role-edit dialog layout', () => {
  it('leaves the body in the paper column, with one lot of padding', () => {
    render(open());

    const content = document.querySelector('.MuiDialogContent-root');
    expect(content).not.toBeNull();

    const paper = content!.closest('.MuiDialog-paper');
    expect(paper).not.toBeNull();

    // Either the body IS the paper's child, or every step up to the paper
    // generates no box — both leave it a flex item of the paper's column.
    for (
      let node = content!.parentElement;
      node !== null && node !== paper;
      node = node.parentElement
    ) {
      expect(globalThis.getComputedStyle(node).display).toBe('contents');
    }
  });

  it('renders the role checklist it is there to show', () => {
    render(open());

    expect(screen.getByTestId('role-edit-dialog')).toBeTruthy();
  });
});
