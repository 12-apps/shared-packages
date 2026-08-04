'use client';

import { Box } from '@mui/material';
import type { JSX, ReactNode } from 'react';

import type { ProviderSetupGuide as Guide, SetupSection } from '@12-apps/payments-backend';

import { DoneRow } from './CredentialFields';
import { ProviderSetupGuide } from './ProviderSetupGuide';

/**
 * The walkthrough, plus the one step whose completion only the OWNER can
 * report.
 *
 * ## The action id is a contract, like PagBank's
 *
 * `SetupStep.action` has always been an opaque id an adapter and a host agree
 * on out of band — PagBank's `homologacao-anexo` asks the host to generate the
 * evidence file its review form wants. This is the second such agreement, and
 * the first whose answer is a FACT rather than a side effect: InfinitePay ships
 * Checkout Integrado disabled and publishes nothing that reports its state, so
 * the only reading available is the owner's.
 *
 * A guide that offers this action is asking "have you done this?", and a host
 * that handles it owes an answer it can remember.
 */
export const CHECKOUT_CONFIRM_ACTION = 'checkout-integrado-confirmado';

/** Does this section end in a question only the owner can answer? */
function isConfirmable(section: SetupSection): boolean {
  return section.steps.some((step) => step.action === CHECKOUT_CONFIRM_ACTION);
}

/**
 * Which stage the walkthrough is REALLY on.
 *
 * The server reports what it can prove — credentials that reach an account, a
 * charge that landed — and that is not the whole answer. One step in the middle
 * can only be confirmed by the owner, because no API reports whether Checkout
 * Integrado is switched on. Left to the server's number alone the screen ticked
 * that step off and jumped to step 3 the moment the probe passed, having never
 * shown it.
 *
 * So an unconfirmed confirmable section holds the walkthrough where it is. And
 * `editing` beats everything: reopening a finished step means going back to it.
 */
function effectiveStage(
  guide: Guide,
  confirmed: boolean,
  editing: boolean,
  stored = true,
): number {
  const stage = guide.activeStage ?? 0;
  if (editing) return 0;
  // Nothing stored for the environment being LOOKED AT ⇒ step 1, whatever the
  // active environment has achieved. `activeStage` is computed from the config
  // the store actually charges with, so on the other tab it reported progress
  // made somewhere else — a walkthrough claiming steps 1 and 2 were done over
  // an empty Produção field, on the screen whose whole subject is which
  // account receives the money.
  if (!stored) return 0;
  if (confirmed) return stage;
  const waiting = confirmableStage(guide);
  return waiting < 0 ? stage : Math.min(stage, waiting);
}

/** Index of the stage whose section ends in a question only the owner can answer. */
function confirmableStage(guide: Guide): number {
  return guide.stages.findIndex((stage) => {
    const section = guide.sections.find((candidate) => candidate.id === stage.id);
    return section ? isConfirmable(section) : false;
  });
}

/**
 * The section the walkthrough is showing, or null when it has nothing left.
 *
 * Exported because the ACTIVATION STEP needs the same answer: it is the last
 * stage, so it may only appear once the guide is out of sections. Computing it
 * twice is how the screen ended up rendering "Passo 3 · Ative as vendas" —
 * complete with its pay button — directly under "Passo 2".
 */
export function openSection(
  guide: Guide | null,
  confirmed: boolean,
  editing: boolean,
  stored = true,
) {
  if (!guide) return null;
  return sectionAt(guide, effectiveStage(guide, confirmed, editing, stored));
}

/** The section paired with a stage, when the adapter ships one for it. */
function sectionAt(guide: Guide, stage: number): SetupSection | null {
  const wanted = guide.stages[stage];
  if (!wanted) return null;
  return guide.sections.find((section) => section.id === wanted.id) ?? null;
}

export interface SetupGuideSectionProps {
  guide: Guide | null;
  /** The owner has confirmed the step that only they can see. */
  confirmed: boolean;
  onConfirm: () => void;
  /** Re-open the confirmed step — the owner wants to check it again. */
  onReopen: () => void;
  /** Rows for steps finished elsewhere (a saved credential), shown alongside. */
  rows?: ReactNode;
  /** The live control for the open step — the credential form. */
  sectionFooter?: ReactNode;
  /** The owner has reopened a finished step; show that step, not the current one. */
  editing?: boolean;
  /** The environment on screen holds its credentials — see `renderGuide`. */
  stored?: boolean;
}

/**
 * A confirmed step collapses to one line, exactly as a saved credential does.
 *
 * Not removed: "I told you this was on" is the claim step 3 is about to test,
 * and when the provider then refuses to mint a link, the owner needs the row
 * still there to press Revisar on.
 */
function ConfirmedRow({ section, onReopen }: { section: SetupSection; onReopen: () => void }) {
  return (
    <DoneRow
      testId="payments-setup-confirmed"
      label={section.doneSummary?.label ?? section.title}
      value={section.doneSummary?.value ?? 'Confirmado por você'}
      editLabel="Revisar"
      onEdit={onReopen}
    />
  );
}

export function SetupGuideSection({
  guide,
  confirmed,
  onConfirm,
  onReopen,
  rows,
  sectionFooter,
  editing = false,
  stored = true,
}: SetupGuideSectionProps): JSX.Element {
  // No walkthrough — PagBank ships none, because under Connect the platform is
  // reviewed centrally and the owner has nothing to follow. The SLOTS still
  // have to render: they are the credential form, and swallowing them left a
  // provider with a status chip, a pair of environment tabs and no way to type
  // anything in.
  if (!guide) {
    return (
      <>
        {rows}
        {sectionFooter}
      </>
    );
  }

  const stage = effectiveStage(guide, confirmed, editing, stored);
  const open = sectionAt(guide, stage);
  // The confirmed step keeps a row of its own once the walkthrough has moved
  // past it — it is the claim step 3 is about to test, and when the provider
  // refuses to mint a link the owner needs somewhere to press Revisar.
  const settledStage = confirmableStage(guide);
  const settled = confirmed && !editing && settledStage >= 0 && stage > settledStage;
  const settledSection = settled ? sectionAt(guide, settledStage) : null;

  return (
    <Box data-testid="payments-setup">
      <ProviderSetupGuide
        guide={{ ...guide, sections: open ? [open] : [] }}
        activeStage={stage}
        actions={{
          [CHECKOUT_CONFIRM_ACTION]: {
            label: 'Já habilitei o Checkout Integrado',
            run: onConfirm,
          },
        }}
        beforeSections={
          <>
            {rows}
            {settledSection ? <ConfirmedRow section={settledSection} onReopen={onReopen} /> : null}
          </>
        }
        sectionFooter={sectionFooter}
      />
    </Box>
  );
}
