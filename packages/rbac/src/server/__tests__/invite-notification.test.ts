/**
 * The silent invite, and the port that ends it.
 *
 * The RFC opens on this incident: `invites.invite()` upserts and tells no one.
 * These cases pin the whole of the fix — that a bound port is TOLD, that an
 * unbound one changes nothing (so adopting is safe for every host that has the
 * surface today), that the emit happens after the write, and that the two
 * reachability cases are distinguished rather than papered over.
 */

import { describe, expect, it } from 'vitest';

import {
  createTeamInvitedBlueprint,
  TEAM_INVITED_NOTIFICATION_TYPE,
  type RbacNotifyEvent,
  type RbacNotifyPort,
  type TeamInvitedPayload,
} from '../notifications';
import { EN_US_TEAM_INVITED_COPY } from '../en-US';
import { TEAM_INVITED_COPY } from '../locales';
import { PT_BR_TEAM_INVITED_COPY } from '../pt-BR';
import type { RbacRequest, RbacResponse } from '../context';
import { enrolMember } from './fake-db';
import { createTestHost, memberActor, type TestHost } from './server-fixtures';

const TENANT = 'tenant-a';

function call(
  host: TestHost,
  method: string,
  path: string,
  request: Partial<RbacRequest> & { actor: RbacRequest['actor'] },
): Promise<RbacResponse> {
  const found = host.api.routes.find((route) => route.method === method && route.path === path);
  if (!found) throw new Error(`No route ${method} ${path}`);
  return found.handle({ params: {}, query: {}, ...request });
}

/** A recorder built per case — no closed-over binding reassigned in a stub. */
function recorder(): { port: RbacNotifyPort; events: RbacNotifyEvent[] } {
  const events: RbacNotifyEvent[] = [];
  return {
    events,
    port: {
      emit: (event) => {
        events.push(event);
        return Promise.resolve({ accepted: true });
      },
    },
  };
}

interface InviteResult {
  status: 'added' | 'invited';
  userId?: string;
}

async function inviteHost(result: InviteResult, notify?: RbacNotifyPort) {
  const host = createTestHost({
    invites: {
      invite: () => Promise.resolve(result),
      listPending: () => Promise.resolve([]),
      cancel: () => Promise.resolve(undefined),
    },
    ...(notify ? { notify } : {}),
  });
  await host.api.seedTenantRoles(TENANT);
  enrolMember(host.state, TENANT, 'owner-1', 'DIRECTOR');
  return host;
}

describe('POST /team tells the invitee', () => {
  it('emits rbac.team.invited to the granted account', async () => {
    const { port, events } = recorder();
    const host = await inviteHost({ status: 'added', userId: 'u-new' }, port);

    const response = await call(host, 'POST', '/team', {
      actor: memberActor(TENANT, 'owner-1'),
      body: { email: 'Novo@Example.com ' },
    });

    expect(response.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: TEAM_INVITED_NOTIFICATION_TYPE,
      recipient: { userId: 'u-new' },
      payload: {
        tenantId: TENANT,
        // Normalised by the route before the port ever saw it, and the payload
        // carries what was actually invited rather than what was typed.
        email: 'novo@example.com',
        status: 'added',
        invitedByUserId: 'owner-1',
      },
    });
  });

  it('emits only AFTER the invite is recorded — never about a row that is not there', async () => {
    const { port, events } = recorder();
    const order: string[] = [];
    const host = createTestHost({
      invites: {
        invite: () => {
          order.push('write');
          return Promise.resolve({ status: 'added' as const, userId: 'u-new' });
        },
        listPending: () => Promise.resolve([]),
        cancel: () => Promise.resolve(undefined),
      },
      notify: {
        emit: (event) => {
          order.push('notify');
          return port.emit(event);
        },
      },
    });
    await host.api.seedTenantRoles(TENANT);
    enrolMember(host.state, TENANT, 'owner-1', 'DIRECTOR');

    await call(host, 'POST', '/team', {
      actor: memberActor(TENANT, 'owner-1'),
      body: { email: 'novo@example.com' },
    });

    expect(order).toEqual(['write', 'notify']);
    expect(events).toHaveLength(1);
  });

  it('skips the emit for an accountless invitee — there is no inbox to write to', async () => {
    // The `invited` branch means no account exists yet. Reaching that reader is
    // a MAIL to an address, which is a different port and stays the host's
    // signup flow; inventing a recipient here would notify the wrong person.
    const { port, events } = recorder();
    const host = await inviteHost({ status: 'invited' }, port);

    const response = await call(host, 'POST', '/team', {
      actor: memberActor(TENANT, 'owner-1'),
      body: { email: 'novo@example.com' },
    });

    expect(response.status).toBe(200);
    expect(events).toEqual([]);
  });

  it('changes nothing for a host that binds no port — the invite still succeeds', async () => {
    // Adopting must be safe for every host running the surface today: an
    // unbound capability is a written decline in the wiring report, not a
    // behaviour change.
    const host = await inviteHost({ status: 'added', userId: 'u-new' });

    const response = await call(host, 'POST', '/team', {
      actor: memberActor(TENANT, 'owner-1'),
      body: { email: 'novo@example.com' },
    });

    expect(response.status).toBe(200);
    expect(host.audits.map((entry) => entry.action)).toEqual(['team.invite']);
  });
});

describe('the blueprint the host words itself', () => {
  function payload(status: 'added' | 'invited'): TeamInvitedPayload {
    return { tenantId: TENANT, email: 'novo@example.com', status };
  }

  it('declares the wire type and suggests a category the host taxonomy can veto', () => {
    const blueprint = createTeamInvitedBlueprint(PT_BR_TEAM_INVITED_COPY);
    expect(blueprint.type).toBe('rbac.team.invited');
    expect(blueprint.category).toBe('system');
  });

  it('says two different things, because there are two different facts', () => {
    // "You now have access" to somebody who cannot sign in yet is the failure
    // this split exists to avoid.
    const blueprint = createTeamInvitedBlueprint(PT_BR_TEAM_INVITED_COPY);
    const added = blueprint.generate(payload('added'));
    const invited = blueprint.generate(payload('invited'));

    expect(added.title).toBe('Você foi adicionado à equipe');
    expect(added.body).toContain('Sua conta agora tem acesso');
    expect(invited.title).toBe('Convite para a equipe');
    expect(invited.body).toContain('Conclua o cadastro');
    expect(invited.body).toContain('novo@example.com');
  });

  it('carries the facts as data, so a host surface can read them without parsing copy', () => {
    const blueprint = createTeamInvitedBlueprint(PT_BR_TEAM_INVITED_COPY);
    const content = blueprint.generate({ ...payload('added'), invitedByUserId: 'owner-1' });
    expect(content.data).toEqual({
      tenantId: TENANT,
      email: 'novo@example.com',
      status: 'added',
      invitedByUserId: 'owner-1',
    });
  });

  it('takes the host words rather than shipping any — a package default would be a silent pt-BR', () => {
    const blueprint = createTeamInvitedBlueprint({
      title: () => 'You were added',
      body: () => 'Welcome aboard.',
      link: () => '/dashboard',
    });
    const content = blueprint.generate(payload('added'));
    expect(content).toMatchObject({
      title: 'You were added',
      body: 'Welcome aboard.',
      link: '/dashboard',
    });
  });
});

/**
 * THE WORDS FOLLOW THE INVITEE, not the process.
 *
 * A blueprint is built once, at the host's mount, and the notice it renders is
 * stored as TEXT — so before this, whichever language the mount named was the
 * language every future invitee read, forever, and a single-locale host could
 * never tell. These cases pin the two halves that close it: the factory takes
 * a resolver, and `generate` is what calls it.
 */
describe('the invite notice in the reader\'s language', () => {
  const payload: TeamInvitedPayload = {
    tenantId: TENANT,
    email: 'novo@example.test',
    status: 'invited',
  };

  /** What a bilingual host writes — the shape `localeCopy(PACK)` produces. */
  const resolver = ({ locale }: { readonly locale?: string | null }) =>
    locale === 'en-US' ? TEAM_INVITED_COPY['en-US'] : TEAM_INVITED_COPY['pt-BR'];

  it('renders each recipient in their own language from ONE blueprint', () => {
    // One blueprint, built once — exactly as a host mounts it.
    const blueprint = createTeamInvitedBlueprint(resolver);

    expect(blueprint.generate(payload, { locale: 'en-US' }).title).toBe(
      EN_US_TEAM_INVITED_COPY.title(payload),
    );
    expect(blueprint.generate(payload, { locale: 'pt-BR' }).title).toBe(
      PT_BR_TEAM_INVITED_COPY.title(payload),
    );
  });

  it('resolves at generate, never at build — the failure this replaces', () => {
    /*
      Asked how many times the resolver ran: once per notice, not once per
      mount. A factory that resolved eagerly would answer 1 here and would pass
      every assertion above that used a single language.
    */
    // A COUNTER OBJECT, not a closed-over `let`: reassigning a binding from
    // inside a stub is what `no-global-state-mutation` refuses, and the
    // recorder above this file follows the same rule for the same reason.
    const seen = { calls: 0 };
    const counted = (context: { readonly locale?: string | null }) => {
      seen.calls += 1;
      return resolver(context);
    };

    const blueprint = createTeamInvitedBlueprint(counted);
    expect(seen.calls).toBe(0);

    blueprint.generate(payload, { locale: 'en-US' });
    blueprint.generate(payload, { locale: 'pt-BR' });
    expect(seen.calls).toBe(2);
  });

  it('treats an absent context as "nobody said" rather than an error', () => {
    // A runtime with no language for this reader — the honest state for a host
    // that stores none yet — still renders, in whatever the resolver defaults to.
    const blueprint = createTeamInvitedBlueprint(resolver);

    expect(blueprint.generate(payload).title).toBe(PT_BR_TEAM_INVITED_COPY.title(payload));
    expect(blueprint.generate(payload, {}).title).toBe(PT_BR_TEAM_INVITED_COPY.title(payload));
  });

  it('still accepts a plain table, so a single-audience host is unchanged', () => {
    const blueprint = createTeamInvitedBlueprint(PT_BR_TEAM_INVITED_COPY);

    expect(blueprint.generate(payload, { locale: 'en-US' }).title).toBe(
      PT_BR_TEAM_INVITED_COPY.title(payload),
    );
  });
});
