import type { EntitlementsMessages } from './copy';
import type { EntitlementPermissionLabels } from './contribution';
import type { PlanChangedCopy, PlanLabelLookup } from './notifications';

/**
 * The pt-BR pack — the origin host's exact sentences, now a NAMED export a
 * host passes by hand (`messages: PT_BR_ENTITLEMENTS_MESSAGES`), never a
 * default. The filename is what exempts this file from the copy-portability
 * gate: Portuguese may ship, it may not be silent. Facts are interpolated
 * rather than hard-coded so a host that raises a ceiling or renames a tier
 * cannot end up with copy naming the old number.
 */
export const PT_BR_ENTITLEMENTS_MESSAGES: EntitlementsMessages = {
  unauthenticated: 'Não autenticado.',
  planRequestForbidden: 'Sem permissão para solicitar mudança de plano.',
  invalidPlanRequest: 'Pedido inválido.',
  paymentRequired: 'Este recurso não está incluído no seu plano.',
  featureDisabledByTenant: 'Este recurso está desativado nas configurações.',
  featureUnavailable: 'Recurso indisponível.',
  featureNotes: {
    enabled: 'Incluído no seu plano',
    'not-entitled': 'Não incluído no seu plano',
    // Their own switch. Saying "not included" here would send them to buy a
    // tier that changes nothing. Deliberately does NOT name a screen — the
    // precise destination is a route, so the SPA that owns the routes names
    // it, keyed off `reason`.
    'disabled-by-tenant': 'Desligado por você nas configurações',
    restricted: 'Suspenso enquanto houver pendência financeira',
    suspended: 'Suspenso — fale com o suporte',
  },
  overQuotaNote: ({ limit, used, nextPlanLabel }) => {
    const kept = `Seu plano inclui ${limit} e você tem ${used}. Todos continuam ativos`;
    if (nextPlanLabel === null) return `${kept}.`;
    return `${kept} — para criar novos, assine o ${nextPlanLabel}.`;
  },
  quotaRaceRetry: 'Não foi possível concluir agora. Tente novamente.',
  lossLine: (loss) => {
    const fate =
      loss.policy === 'readonly'
        ? 'mantém o que já tem, não pode crescer'
        : loss.policy === 'hide'
          ? 'a área some'
          : 'fica desabilitado';
    const range =
      loss.kind === 'narrowed' ? `${String(loss.before)} → ${String(loss.after)}` : 'perde';
    const upsell = loss.requiredPlan === null ? '' : ` (volta no "${loss.requiredPlan}")`;
    return `${loss.feature}: ${range} — ${fate}${upsell}`;
  },
  offLadderNote: ({ offLadder, total, defaultPlanKey }) =>
    `${offLadder}/${total} em um tier fora da escada (chave aposentada ` +
    `ou escrita à mão) SEM assinatura ativa. O resolvedor já os trata como ` +
    `"${defaultPlanKey}", e é contra esse teto que foram medidos acima.`,
  unscorableNote: ({ unscorable, total }) =>
    `${unscorable}/${total} têm assinatura ativa em um plano fora da escada. ` +
    `Os limites deles vêm do snapshot congelado da assinatura, que o catálogo não ` +
    `modela — ficaram FORA da conta acima e precisam ser conferidos à mão.`,
  tierBreakdownAboveTop: ({ topTier, count }) => `⚠️ acima do ${topTier} ${count}`,
  tierBreakdownOffLadder: ({ tier, count }) => `⚠️ ${tier} ${count}`,
};

/**
 * The segment words `entitlementsPermissions` used to compile in — the role
 * editor's vocabulary for this package's one id. Passed by hand at the
 * composition seam (`entitlementsPermissions(PT_BR_ENTITLEMENTS_PERMISSION_LABELS)`),
 * which lives beside the host's own catalog rather than behind the mount.
 */
export const PT_BR_ENTITLEMENTS_PERMISSION_LABELS: EntitlementPermissionLabels = {
  domains: { plan: 'Plano' },
  actions: { request: 'Solicitar mudança' },
};

/**
 * The plan-change notice's phrasing and CTA — pass to
 * `createPlanChangedBlueprint`.
 *
 * A FACTORY over the host's plan-label lookup, not a constant: the tier names
 * are a commercial catalog this package does not hold, so the pack asks for
 * the spelling and supplies only the sentence around it.
 *
 * Three sentences because there are three facts, and telling a downgraded
 * tenant it has "more room now" is the failure worth avoiding.
 */
export const ptBrPlanChangedCopy = (label: PlanLabelLookup): PlanChangedCopy => ({
  title: (payload) =>
    payload.direction === 'downgrade' ? 'Seu plano foi alterado' : 'Seu plano foi atualizado',
  body: (payload) => {
    const to = label(payload.toPlanKey);
    // No noun for the tenant. Every candidate is one application's word for
    // it, and a shared package that ships one hands that vocabulary to every
    // adopter — which the brand gate refuses, rightly, and refuses in comments
    // too. The second person carries the sentence without naming what the
    // reader owns.
    if (payload.direction === 'upgrade') {
      return `Você agora está no plano ${to}. Os novos recursos já estão liberados.`;
    }
    if (payload.direction === 'downgrade') {
      return `Você passou para o plano ${to}. Alguns recursos podem não estar mais disponíveis.`;
    }
    return `Você agora está no plano ${to}.`;
  },
  link: () => '/admin/plano',
});
