// @vitest-environment jsdom
/**
 * The two invite outcomes are both SAID (FUT-3135).
 *
 * A live grant — the address already had an account — used to close the dialog
 * and refresh the roster with no word at all. The roster is sorted, so the new
 * row often landed on another page and the add read as nothing having
 * happened. It now confirms who was added and, when the server names the
 * member, offers the way to their profile wherever the roster put them.
 *
 * Driven through the hook the screen uses and the banners it renders, with a
 * fake client: what is under test is what each answer of `POST /team` puts on
 * screen, not the wire.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { labelsOf } from '../../core/compose';
import { DEMO_CATALOG } from '../../__tests__/demo-catalog';

import type { InviteResultWire, RbacApiClient } from '../api';
import { RbacProvider } from '../context';
import { createRbacLabels } from '../labels';
import { PT_BR_RBAC_WEB_COPY } from '../pt-BR';
import { TeamScreen } from '../team-screen';
import { TeamBanners } from '../team-screen-parts';
import type { RbacResult } from '../transport';
import { useTeamActions, type TeamActions } from '../use-team-actions';

const copy = PT_BR_RBAC_WEB_COPY;

/** A client whose invite answers `result`; nothing else is called. */
function clientAnswering(result: RbacResult<InviteResultWire>): RbacApiClient {
  return {
    inviteMember: vi.fn(async () => result),
  } as unknown as RbacApiClient;
}

async function inviteWith(
  result: RbacResult<InviteResultWire>,
  email = 'Ana@Example.com ',
): Promise<{ actions: () => TeamActions; refresh: ReturnType<typeof vi.fn> }> {
  const refresh = vi.fn();
  const hook = renderHook(() => useTeamActions(clientAnswering(result), copy, refresh));
  await act(() => hook.result.current.invite({ email, role: 'ADMIN', customRoles: [] }));
  return { actions: () => hook.result.current, refresh };
}

/** Which of the three banners are on screen, in render order — asserted as a whole. */
function bannersShown(): string[] {
  return ['team-invite-added', 'team-invite-notice', 'team-error'].filter(
    (id) => screen.queryAllByTestId(id).length > 0,
  );
}

/** The added banner's own action, by test id — present or not. */
function openActionShown(): boolean {
  return screen.queryAllByTestId('team-invite-added-open').length > 0;
}

function renderBanners(actions: TeamActions, onOpenMember?: (userId: string) => void): void {
  render(<TeamBanners actions={actions} copy={copy} onOpenMember={onOpenMember} />);
}

describe('the live-grant confirmation', () => {
  it('names who was added and opens their profile', async () => {
    const { actions, refresh } = await inviteWith({
      ok: true,
      data: { status: 'added', userId: 'u-ana' },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(actions().showForm).toBe(false);
    expect(actions().notice).toBe(false);
    const open = vi.fn();
    renderBanners(actions(), open);

    const banner = screen.getByTestId('team-invite-added');
    expect(banner.textContent).toContain('Adicionado à equipe');
    // The address as the roster will list it — trimmed and lowercased.
    expect(banner.textContent).toContain('ana@example.com agora faz parte da equipe.');
    expect(bannersShown()).toEqual(['team-invite-added']);

    fireEvent.click(screen.getByTestId('team-invite-added-open'));
    expect(open).toHaveBeenCalledWith('u-ana');
  });

  it('reads the legacy `granted` spelling as a live grant too', async () => {
    const { actions } = await inviteWith({
      ok: true,
      data: { status: 'granted' },
    });
    expect(actions().added).toEqual({ email: 'ana@example.com' });
    expect(actions().notice).toBe(false);
    // The super-admin console's route answers this spelling, with no id.
    renderBanners(actions(), vi.fn());
    expect(screen.getByTestId('team-invite-added').textContent).toContain(
      'ana@example.com agora faz parte da equipe.',
    );
    expect(bannersShown()).toEqual(['team-invite-added']);
    expect(openActionShown()).toBe(false);
  });

  it('still confirms when the server reported no id — without the button', async () => {
    const { actions } = await inviteWith({
      ok: true,
      data: { status: 'added' },
    });
    renderBanners(actions(), vi.fn());
    expect(screen.getByTestId('team-invite-added').textContent).toContain('ana@example.com');
    expect(openActionShown()).toBe(false);
  });

  it('shows no button when the host routes no profile screen', async () => {
    const { actions } = await inviteWith({
      ok: true,
      data: { status: 'added', userId: 'u-ana' },
    });
    renderBanners(actions());
    expect(screen.getByTestId('team-invite-added')).toBeTruthy();
    expect(openActionShown()).toBe(false);
  });

  it('closes on its ✕', async () => {
    const refresh = vi.fn();
    const hook = renderHook(() =>
      useTeamActions(clientAnswering({ ok: true, data: { status: 'added' } }), copy, refresh),
    );
    await act(() =>
      hook.result.current.invite({
        email: 'a@b.c',
        role: 'ADMIN',
        customRoles: [],
      }),
    );
    const view = render(<TeamBanners actions={hook.result.current} copy={copy} />);
    fireEvent.click(screen.getByRole('button', { name: copy.closeLabel }));
    // The Alert collapses first and reports the close when that finishes.
    await waitFor(() => expect(hook.result.current.added).toBeNull());
    view.rerender(<TeamBanners actions={hook.result.current} copy={copy} />);
    expect(bannersShown()).toEqual([]);
  });
});

describe('the other outcomes are unchanged', () => {
  it('a deferred invite shows "Convite enviado" and no added banner', async () => {
    const { actions } = await inviteWith({
      ok: true,
      data: { status: 'invited' },
    });
    expect(actions().added).toBeNull();
    renderBanners(actions(), vi.fn());
    expect(screen.getByTestId('team-invite-notice').textContent).toContain('Convite enviado');
    expect(bannersShown()).toEqual(['team-invite-notice']);
  });

  // FUT-3137: the reason goes to the dialog, which stays open; the page banner
  // sits behind the modal, where a refusal used to land unseen.
  it('a refused invite keeps the dialog open with the reason, and confirms nothing', async () => {
    const refresh = vi.fn();
    const hook = renderHook(() =>
      useTeamActions(clientAnswering({ ok: false, error: 'E-mail inválido.' }), copy, refresh),
    );
    act(() => hook.result.current.openForm());
    await act(() =>
      hook.result.current.invite({
        email: 'x',
        role: 'ADMIN',
        customRoles: [],
      }),
    );
    expect(hook.result.current.added).toBeNull();
    expect(hook.result.current.notice).toBe(false);
    expect(hook.result.current.showForm).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    expect(hook.result.current.inviteError).toBe('E-mail inválido.');
    expect(hook.result.current.error).toBeNull();
    renderBanners(hook.result.current);
    expect(bannersShown()).toEqual([]);
  });

  it('a new invite replaces the previous confirmation with its own outcome', async () => {
    let answer: RbacResult<InviteResultWire> = {
      ok: true,
      data: { status: 'added' },
    };
    const api = {
      inviteMember: vi.fn(async () => answer),
    } as unknown as RbacApiClient;
    const hook = renderHook(() => useTeamActions(api, copy, vi.fn()));
    await act(() =>
      hook.result.current.invite({
        email: 'a@b.c',
        role: 'ADMIN',
        customRoles: [],
      }),
    );
    expect(hook.result.current.added).toEqual({ email: 'a@b.c' });

    answer = { ok: true, data: { status: 'invited' } };
    await act(() =>
      hook.result.current.invite({
        email: 'd@e.f',
        role: 'ADMIN',
        customRoles: [],
      }),
    );
    expect(hook.result.current.added).toBeNull();
    expect(hook.result.current.notice).toBe(true);
  });

  it('a refusal after a confirmation clears the confirmation and says why in the dialog', async () => {
    let answer: RbacResult<InviteResultWire> = {
      ok: true,
      data: { status: 'added', userId: 'u-a' },
    };
    const api = {
      inviteMember: vi.fn(async () => answer),
    } as unknown as RbacApiClient;
    const hook = renderHook(() => useTeamActions(api, copy, vi.fn()));
    await act(() => hook.result.current.invite({ email: 'a@b.c', role: 'ADMIN', customRoles: [] }));
    expect(hook.result.current.added).toEqual({ email: 'a@b.c', userId: 'u-a' });

    answer = { ok: false, error: 'Recusado.' };
    await act(() => hook.result.current.invite({ email: 'd@e.f', role: 'ADMIN', customRoles: [] }));
    expect(hook.result.current.inviteError).toBe('Recusado.');
    renderBanners(hook.result.current, vi.fn());
    expect(bannersShown()).toEqual([]);
  });

  it('a refusal is cleared by the next attempt, and by closing or reopening the dialog', async () => {
    let answer: RbacResult<InviteResultWire> = { ok: false, error: 'Sem vagas.' };
    const client = { inviteMember: vi.fn(async () => answer) } as unknown as RbacApiClient;
    const hook = renderHook(() => useTeamActions(client, copy, vi.fn()));
    const attempt = (): Promise<void> =>
      hook.result.current.invite({ email: 'a@b.c', role: 'ADMIN', customRoles: [] });

    act(() => hook.result.current.openForm());
    await act(attempt);
    expect(hook.result.current.inviteError).toBe('Sem vagas.');
    act(() => hook.result.current.toggleForm());
    expect(hook.result.current.inviteError).toBeNull();

    act(() => hook.result.current.openForm());
    await act(attempt);
    act(() => hook.result.current.openForm());
    expect(hook.result.current.inviteError).toBeNull();

    await act(attempt);
    answer = { ok: true, data: { status: 'added' } };
    await act(attempt);
    expect(hook.result.current.inviteError).toBeNull();
    expect(hook.result.current.showForm).toBe(false);
  });
});

/**
 * The whole screen, as a host mounts it: what reaches the banner is the
 * screen's own `onOpenMember` — the host's `navigate.member` — and nothing a
 * test hands `TeamBanners` directly. Dropping that one prop would leave every
 * case above green and **Ver perfil** gone from both apps.
 */
describe('through the screen', () => {
  const MANAGE = 'team:manage';

  function fakeApi(): RbacApiClient {
    return {
      listTeam: vi.fn(async () => ({
        data: [
          {
            userId: 'u-owner',
            role: 'HEAD_LIBRARIAN',
            email: 'o@b.c',
            name: 'Olga',
            image: null,
            active: true,
            status: 'ENABLED',
          },
        ],
        pagination: { total: 1, page: 1, pageSize: 20, pageCount: 1, hasNextPage: false },
      })),
      teamContext: vi.fn(async () => ({
        customRolesByMember: [],
        assignableRoles: ['HEAD_LIBRARIAN', 'CLERK'],
        pendingInvites: [],
        invitesEnabled: true,
      })),
      inviteMember: vi.fn(async () => ({ ok: true, data: { status: 'added', userId: 'u-ana' } })),
    } as unknown as RbacApiClient;
  }

  function mountScreen(api: RbacApiClient, openMember = vi.fn()): void {
    render(
      <MemoryRouter>
        <RbacProvider permissions={new Set([MANAGE])}>
          <TeamScreen
            api={api}
            labels={createRbacLabels(labelsOf(DEMO_CATALOG))}
            copy={copy}
            systemRoles={['HEAD_LIBRARIAN', 'CLERK']}
            ownerRoles={['DIRECTOR']}
            managePermission={MANAGE}
            defaultInviteRole="CLERK"
            onOpenMember={openMember}
            inviteRequested
          />
        </RbacProvider>
      </MemoryRouter>,
    );
  }

  /** Types `address` into the open dialog and submits it; answers the dialog and its field. */
  async function submitInvite(
    address: string,
  ): Promise<{ dialog: HTMLElement; email: HTMLInputElement }> {
    const dialog = await screen.findByTestId('invite-dialog');
    const email = dialog.querySelector<HTMLInputElement>('input[name="email"]');
    if (!email) throw new Error('the invite form has no e-mail field');
    fireEvent.change(email, { target: { value: address } });
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === copy.teamScreen.inviteAction,
      ) as HTMLButtonElement,
    );
    return { dialog, email };
  }

  it("opens the new member's profile through the screen's onOpenMember", async () => {
    const openMember = vi.fn();
    const api = fakeApi();
    mountScreen(api, openMember);
    await submitInvite('ana@example.com');

    const open = await screen.findByTestId('team-invite-added-open');
    expect(api.inviteMember).toHaveBeenCalledWith('ana@example.com', expect.anything());
    expect(screen.getByTestId('team-invite-added').textContent).toContain('ana@example.com');
    fireEvent.click(open);
    expect(openMember).toHaveBeenCalledWith('u-ana');
  });

  // FUT-3137: a refusal used to land in the page banner, behind the modal.
  it('says a refused add inside the dialog and keeps what was typed', async () => {
    const api = fakeApi();
    const refusal = 'Este recurso não está incluído no seu plano.';
    vi.mocked(api.inviteMember).mockResolvedValue({ ok: false, error: refusal });
    // jsdom does no layout and has no scrollIntoView; record who asked for it.
    const scrolled: Element[] = [];
    const scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    });
    onTestFinished(() => {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    });
    mountScreen(api);
    const typed = await submitInvite('ana@example.com');

    const alert = await screen.findByTestId('invite-error');
    expect(typed.dialog.contains(alert)).toBe(true);
    expect(alert.textContent).toContain(copy.teamScreen.inviteFailedTitle);
    expect(alert.textContent).toContain(refusal);
    expect(typed.email.value).toBe('ana@example.com');
    expect(screen.queryAllByTestId('team-error')).toHaveLength(0);
    // The submit is under the role list: the reason scrolls itself into view.
    expect(scrolled.some((el) => el.contains(alert))).toBe(true);
  });
});
