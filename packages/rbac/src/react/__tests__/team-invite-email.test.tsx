// @vitest-environment jsdom
/**
 * The invite's e-mail box (FUT-4144) and its banner (FUT-4143).
 *
 * It took the address as plain text, judged only that it was not empty — in
 * forms-core's English — and let "nao-e-email" through to the server, while a
 * failed submit raised an English banner over a Portuguese form. The address
 * is somebody else's, so the browser must not offer the signed-in user's own.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PT_BR_FORMS_MESSAGES } from '@12-apps/forms-core';
import { describe, expect, it, vi } from 'vitest';

import { EN_US_RBAC_WEB_COPY } from '../en-US';
import { createRbacLabels } from '../labels';
import { PT_BR_RBAC_WEB_COPY } from '../pt-BR';
import { TeamInviteForm, type InviteSelection } from '../team-invite-form';

type TeamCopy = typeof PT_BR_RBAC_WEB_COPY.teamScreen;

function renderInvite(copy: TeamCopy = PT_BR_RBAC_WEB_COPY.teamScreen) {
  const onSubmit = vi.fn<(selection: InviteSelection) => Promise<void>>(async () => {});
  render(
    <TeamInviteForm
      formKey={0}
      copy={copy}
      labels={createRbacLabels()}
      systemRoles={['ADMIN']}
      customRoles={[]}
      defaultRole="ADMIN"
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

function emailInput(): HTMLInputElement {
  return screen.getByTestId('total-form-field-email') as HTMLInputElement;
}

function typeEmail(value: string): void {
  fireEvent.change(emailInput(), { target: { value } });
}

function submit(): void {
  fireEvent.submit(screen.getByTestId('invite-form'));
}

function emailMessage(): string | null {
  return screen.queryByTestId('total-form-field-email-message')?.textContent ?? null;
}

describe('the invite e-mail box', () => {
  it('E1: is type=email with autocomplete=off on the <input>', () => {
    renderInvite();
    expect(emailInput().getAttribute('type')).toBe('email');
    expect(emailInput().getAttribute('autocomplete')).toBe('off');
  });

  it('E2: "nao-e-email" is marked in pt-BR and never reaches the server', async () => {
    const { onSubmit } = renderInvite();
    typeEmail('nao-e-email');
    submit();
    await waitFor(() => expect(emailMessage()).toBe('Informe um e-mail válido'));
    expect(emailMessage()).toBe(PT_BR_FORMS_MESSAGES.email);
    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('E3: an empty address is refused in Portuguese', async () => {
    const { onSubmit } = renderInvite();
    submit();
    await waitFor(() =>
      expect(emailMessage()).toBe(PT_BR_RBAC_WEB_COPY.teamScreen.inviteEmailRequired),
    );
    expect(emailMessage()).not.toBe('This field is required');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('E4: a well-formed address is sent', async () => {
    const { onSubmit } = renderInvite();
    typeEmail('ana@example.com');
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ email: 'ana@example.com', role: 'ADMIN' });
  });
});

describe('the banner after a failed invite', () => {
  it('B1: reads "Corrija os campos destacados e tente novamente." in pt-BR', async () => {
    renderInvite();
    typeEmail('nao-e-email');
    submit();
    const banner = await screen.findByTestId('total-form-error-snackbar');
    expect(banner.textContent).toContain('Corrija os campos destacados e tente novamente.');
  });

  it('B2: and the en-US pack says it in English', async () => {
    renderInvite(EN_US_RBAC_WEB_COPY.teamScreen);
    submit();
    const banner = await screen.findByTestId('total-form-error-snackbar');
    expect(banner.textContent).toContain(EN_US_RBAC_WEB_COPY.teamScreen.inviteFormError);
    expect(emailMessage()).toBe(EN_US_RBAC_WEB_COPY.teamScreen.inviteEmailRequired);
  });
});
