/**
 * The status band — what is on for THIS tenant right now, and why it is off.
 *
 * The third of the plan screen's three bands, and its own module for the same
 * reason the cards and the table are: `plan-page.tsx` composes the screen and
 * owns the reads; each band owns how it reads.
 *
 * The band exists because it is the only place that distinguishes "your plan
 * does not include this" from "you switched this off yourself" — and, for the
 * second, links to the settings screen holding the switch. Collapsing those
 * two sells an upgrade that changes nothing, which is the single most damaging
 * thing this screen could do.
 */
import { useState, type JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import type { TenantFeatureView } from '../plan-wire';
import type { PlanPageCopy } from './copy';
import type { ResolvedWebConfig } from './web-config';

/**
 * A quota ceiling, or nothing at all for an on/off capability.
 *
 * A ZERO ceiling returns null rather than the "up to 0" wording — that is
 * not a limit a customer can act on, it is a denial pretending to be one,
 * and the row's own note already says the feature is not included.
 */
function ceilingLabel(limit: TenantFeatureView['limit'], copy: PlanPageCopy): string | null {
  if (limit === null) return null;
  if (limit === 'unlimited') return copy.ceilingUnlimited;
  if (limit === 0) return null;
  return copy.ceilingUpTo({ limit });
}

/**
 * The way back to their own switch, named by the host (`copy.openSwitch`).
 *
 * Rendered ONLY for `disabled-by-tenant`, and keyed off that code rather than
 * off `enabled === false`: a tenant-switched feature can equally be dark
 * because the plan never granted it, and offering the toggle there would send
 * them to flip something that cannot help.
 */
function TenantSwitchLink({
  feature,
  config,
}: {
  feature: TenantFeatureView;
  config: ResolvedWebConfig;
}): JSX.Element | null {
  if (feature.reason !== 'disabled-by-tenant') return null;
  const location = config.switchLocation(feature.feature);
  if (location === null) return null;
  const Link = config.LinkComponent;
  return (
    <Text as="div" size="sm" data-testid={`plan-switch-${feature.feature}`}>
      <Link to={location.path}>{config.copy.planPage.openSwitch({ label: location.label })}</Link>
    </Text>
  );
}

/**
 * What a row has to SAY — the second line, and only where there is one.
 *
 * Its own component because most rows have nothing to say: a row that is on
 * and inside its ceiling is fully described by its chip, and all ~40 of them
 * used to carry this block whether or not it applied.
 *
 * It does not name a tier for a DENIAL — those sit under a group heading that
 * names it once (`BlockedByPlan`), and repeating it per row is the wall that
 * grouping exists to remove. It does carry the note, because the note is the
 * part that varies: an over-quota row's note already names the tier that
 * raises the ceiling, and a tenant-switched row's says no tier will help.
 */
function FeatureDenial({
  feature,
  config,
}: {
  feature: TenantFeatureView;
  config: ResolvedWebConfig;
}): JSX.Element {
  return (
    <Box sx={{ mt: 0.25 }}>
      <Text as="div" size="sm" color="secondary">
        {feature.note}
      </Text>
      {/* The mirror image of the group heading: this row is off because of a
          switch the tenant owns, so the useful thing to hand them is the way
          back to it — never a sale, which would change nothing. */}
      <TenantSwitchLink feature={feature} config={config} />
    </Box>
  );
}

/**
 * One capability, as one line — with a second line ONLY where something is
 * wrong.
 *
 * Every row used to carry a label, a note, an upsell sentence and a link as
 * four stacked blocks, on all ~40 features, enabled ones included. A row that
 * is simply on has nothing to explain: the chip is the whole message, and the
 * ceiling ("até 100") rides beside it because that is the only other fact a
 * working feature has. The prose is kept for the rows that are OFF, which is
 * where the screen actually has something to say.
 */
/**
 * Whether this row has a second line at all.
 *
 * `enabled` alone is NOT the test, and getting that wrong hid a real state:
 * an OVER-QUOTA row is `enabled: true` — the plan includes the feature, the
 * tenant outgrew the ceiling — and carries the one upsell that hangs off a
 * working row. Keying the explanation off `enabled` silently dropped it.
 */
function hasSomethingToSay(feature: TenantFeatureView): boolean {
  return !feature.enabled || feature.requiredPlan !== null;
}

function FeatureRow({
  feature,
  config,
  explain = true,
}: {
  feature: TenantFeatureView;
  config: ResolvedWebConfig;
  /**
   * False under a plan group, whose heading already carries the sentence every
   * row in it would otherwise repeat.
   */
  explain?: boolean;
}): JSX.Element {
  const copy = config.copy.planPage;
  const ceiling = ceilingLabel(feature.limit, copy);
  return (
    <Box
      data-testid={`plan-feature-${feature.feature}`}
      sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
        }}
      >
        <Text as="span" size="sm" weight="medium">
          {feature.description ?? feature.feature}
        </Text>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
          {ceiling === null ? null : (
            <Text as="span" size="sm" color="secondary">
              {ceiling}
            </Text>
          )}
          {/* A CHIP, not a Badge. `@12-apps/ui`'s Badge wraps MUI's, which is
              the notification-DOT primitive: it renders its children as bare
              text with an invisible dot anchored to them, so the one marker
              distinguishing an available row from a withheld one arrived as
              unstyled grey text at the far right of the row. A chip is the
              pill this always meant to be, and it is what the tier badges
              above already use. */}
          <Chip
            label={feature.enabled ? copy.statusBadge.enabled : copy.statusBadge.disabled}
            size="sm"
            color={feature.enabled ? 'success' : 'neutral'}
            data-testid={`plan-status-${feature.feature}`}
          />
        </Stack>
      </Box>
      {explain && hasSomethingToSay(feature) ? (
        <FeatureDenial feature={feature} config={config} />
      ) : null}
    </Box>
  );
}

/**
 * The rows needing attention, gathered under the tier that would lift each.
 *
 * "Disponível no plano Pro." is one sentence, and a store on a low tier was
 * reading it ONCE PER ROW — twenty-one rows deep on a real fixture, every one
 * of them saying the same two sentences with a different label above. The
 * label is the only part that varies, so the explanation is stated once and
 * the labels list under it.
 *
 * Only DENIALS an upgrade fixes are grouped. A row dark because the tenant
 * switched it off, one in dunning, or one that is on but over its ceiling,
 * keeps its own line and its own note: those explanations differ per row —
 * the over-quota one carries the numbers — and folding them under
 * a plan heading would sell a tier that changes nothing — the single most
 * damaging thing this screen can do.
 */
interface BlockedGroup {
  /** The tier's KEY — the group's identity, and its test id. */
  planKey: string | null;
  /** The tier's COMMERCIAL name, or null for the rows no tier fixes. */
  planLabel: string | null;
  features: TenantFeatureView[];
}

/**
 * Group in the comparison's own order (cheapest first), so the cheapest way
 * out of a denial is the first thing read. `order` is the tier key sequence
 * from the payload; a plan the comparison does not carry sorts last rather
 * than vanishing.
 */
function groupBlocked(blocked: TenantFeatureView[], order: string[]): BlockedGroup[] {
  const byPlan = new Map<string, TenantFeatureView[]>();
  const ungrouped: TenantFeatureView[] = [];
  for (const feature of blocked) {
    // Grouped only where the heading would say everything the row says: a
    // DENIAL a tier lifts. An over-quota row is `enabled` and its note carries
    // the numbers ("you used 30 of 25"), so it stays ungrouped and keeps them
    // — folding it under "available on X" would delete the only fact on it.
    if (feature.requiredPlan === null || feature.enabled) {
      ungrouped.push(feature);
      continue;
    }
    const bucket = byPlan.get(feature.requiredPlan);
    if (bucket === undefined) byPlan.set(feature.requiredPlan, [feature]);
    else bucket.push(feature);
  }
  const rank = (key: string): number => {
    const at = order.indexOf(key);
    return at === -1 ? order.length : at;
  };
  const groups: BlockedGroup[] = [...byPlan.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, features]) => ({
      planKey: key,
      // The COMMERCIAL name from the payload; the raw key must never face a
      // customer, and is the fallback only because something has to render.
      planLabel: features[0]?.requiredPlanLabel ?? key,
      features,
    }));
  if (ungrouped.length > 0) {
    groups.push({ planKey: null, planLabel: null, features: ungrouped });
  }
  return groups;
}

/** One tier's worth of denials: the sentence once, then the labels. */
function BlockedByPlan({
  group,
  config,
}: {
  group: BlockedGroup;
  config: ResolvedWebConfig;
}): JSX.Element {
  const copy = config.copy.planPage;
  return (
    <Box sx={{ mt: 1.5 }} data-testid={`plan-blocked-${group.planKey ?? 'other'}`}>
      {group.planLabel === null ? null : (
        <Box sx={{ mb: 0.5 }}>
          {/* The sentence every one of these rows used to carry, said once.
              Keyed by the tier so a spec can name the group; the WORDS are
              still the host's `availableOn`, in the commercial name. */}
          <Text
            as="div"
            size="xs"
            weight="bold"
            color="secondary"
            data-testid={`plan-upsell-plan-${group.planKey}`}
          >
            {copy.availableOn({ planLabel: group.planLabel })}
          </Text>
        </Box>
      )}
      {group.features.map((feature) => (
        <FeatureRow
          key={feature.feature}
          feature={feature}
          config={config}
          // Under a plan heading every row is "not included in your plan" by
          // construction, so the note is the heading said again. The ungrouped
          // bucket keeps its notes: there they differ per row and are the
          // whole message.
          explain={group.planLabel === null}
        />
      ))}
    </Box>
  );
}

/**
 * What is on for THIS tenant right now, and why it is off if it is.
 *
 * Kept separate from the cards because it is the only place that
 * distinguishes "your plan does not include this" from "you switched this off
 * yourself" — collapsing those two sells an upgrade that changes nothing.
 *
 * Opens on the BLOCKED rows alone, grouped by the tier that lifts them. A
 * registry of forty-odd capabilities printed in full is a wall a customer
 * scrolls past, and all but a handful of it says "on" — which is the half
 * nobody came to read. What is withheld, and why, is the actionable half and
 * the reason this section exists; the rest is one press away and stays exactly
 * one press away, because a store that wants the whole inventory should not
 * have to hunt for it either.
 */
export function CurrentStatus({
  features,
  planOrder,
  config,
  headed = true,
}: {
  features: TenantFeatureView[];
  /** The comparison's tier keys, cheapest first — the grouping's order. */
  planOrder: string[];
  config: ResolvedWebConfig;
  /**
   * Whether the band draws its own heading. False on the audit ROUTE, whose
   * page header already says it — two "Seu plano hoje" in a row reads as a
   * rendering bug rather than a section.
   */
  headed?: boolean;
}): JSX.Element {
  const copy = config.copy.planPage;
  const [showAll, setShowAll] = useState(false);
  // `hasSomethingToSay`, not `!enabled`: an OVER-QUOTA row is enabled and is
  // the most actionable row on the screen — the tenant outgrew a ceiling and a
  // tier raises it. Opening on "blocked" hid exactly that row.
  const needsAttention = features.filter(hasSomethingToSay);
  const hidden = features.length - needsAttention.length;

  return (
    <Box>
      {headed ? <Heading level="h3">{copy.statusHeading}</Heading> : null}
      <Box sx={{ mb: 1 }}>
        <Text as="div" color="secondary" size="sm">
          {copy.statusIntro}
        </Text>
      </Box>
      {features.length === 0 ? (
        <Text color="secondary">{copy.statusEmpty}</Text>
      ) : (
        <>
          {needsAttention.length === 0 ? (
            <Text as="div" color="secondary" size="sm" data-testid="plan-status-none-blocked">
              {copy.statusNothingBlocked}
            </Text>
          ) : (
            groupBlocked(needsAttention, planOrder).map((group) => (
              <BlockedByPlan key={group.planKey ?? 'other'} group={group} config={config} />
            ))
          )}
          {/* The quiet rows are FLAT: grouping a row that is on and inside its
              ceiling under a plan would be meaningless, since it is not
              waiting on a tier. */}
          {showAll
            ? features
                .filter((feature) => !hasSomethingToSay(feature))
                .map((feature) => (
                  <FeatureRow key={feature.feature} feature={feature} config={config} />
                ))
            : null}
          {hidden === 0 ? null : (
            <Box sx={{ mt: 1 }}>
              <Button
                variant="text"
                size="sm"
                onClick={() => setShowAll((was) => !was)}
                aria-expanded={showAll}
                data-testid="plan-status-toggle"
              >
                {showAll ? copy.statusShowBlocked : copy.statusShowAll({ count: hidden })}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

