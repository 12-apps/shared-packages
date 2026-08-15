'use client';

import {
  Alert,
  Box,
  Button,
  IconButton,
  Link,
  Stack,
  Step,
  StepConnector,
  stepConnectorClasses,
  StepLabel,
  Stepper,
  styled,
  type StepIconProps,
  TextField,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';

import type { ProviderSetupGuide as Guide, SetupSection, SetupStep } from '@12-apps/payments-backend';

import {
  BAR_MSG_SX,
  BAR_SX,
  BTN_PRIMARY_SX,
  BTN_SECONDARY_SX,
  PANEL_SX,
  T,
} from './panel-tokens';

import { richText } from './rich-text';

/**
 * Renders a provider's step-by-step onboarding walkthrough — the reusable
 * equivalent of the PagBank "Como gerar o token e cadastrar as URLs"
 * screen: an onboarding stepper (Conectar conta → Homologar → Ativar
 * vendas) plus numbered instruction sections with dashboard links and
 * copy-paste URL fields. Content comes from the backend adapter's
 * `setupGuide`; this component owns only presentation.
 */
export interface ProviderSetupGuideProps {
  guide: Guide;
  /** Index into `guide.stages` of the merchant's current stage. */
  activeStage?: number;
  /**
   * Handlers for the in-app actions an adapter's steps can request, keyed by
   * the adapter's opaque action id (PagBank asks for `homologacao-anexo`).
   * An action with no handler renders NO button — the step's text still reads
   * correctly on its own, so a host can adopt a provider before implementing
   * its optional conveniences.
   */
  actions?: Record<string, { label: string; run: () => void | Promise<void> }>;
  /**
   * Rendered between the stepper and the current section — where the steps
   * ALREADY finished go, as one-line rows.
   *
   * Above the open card rather than below it, because that is the reading
   * order the stepper promises: done, doing, still to do. Below, a completed
   * step looked like a consequence of the one in progress.
   */
  beforeSections?: ReactNode;
  /**
   * Rendered INSIDE the current section's card, after its steps.
   *
   * This is where the walkthrough stops being prose and becomes the thing
   * itself: the instruction "informe sua InfiniteTag" and the field you type it
   * into are one step, and separating them put a card of advice above a
   * detached input, leaving the owner to work out that the two were related.
   */
  sectionFooter?: ReactNode;
}

function CopyField({
  label,
  text,
  collapsible,
}: {
  label: string;
  text: string;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  if (!collapsible) return <CopyRow label={label} text={text} />;
  return (
    // Stretch, not flex-start: the revealed field is a full-width address and
    // shrinking it to its own content clipped the URL mid-domain. The toggle
    // keeps its intrinsic width by sitting in a Box of its own.
    <Stack spacing={1}>
      <Box>
        <Button
          size="small"
          sx={{ ...BUTTON_SX, px: 0 }}
          onClick={() => setOpen((shown) => !shown)}
          data-testid="payments-setup-copy-reveal"
        >
          {label} {open ? '▴' : '▾'}
        </Button>
      </Box>
      {open ? <CopyRow label={label} text={text} /> : null}
    </Stack>
  );
}

function CopyRow({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
      {/*
        Disabled, not merely read-only: nothing here is to be edited, and a
        live-looking field invited owners to type into the one value on the step
        that is pure reference.
      */}
      <TextField fullWidth size="small" disabled value={text} />
      <IconButton
        aria-label={copied ? 'Copiado' : `Copiar ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => setCopied(true));
        }}
      >
        {copied ? '✓' : '⧉'}
      </IconButton>
    </Stack>
  );
}

/**
 * Sentence case. MUI upper-cases button labels by default, which turns copy
 * written to be read into copy that is shouted — "VER A MINHA INFINITETAG"
 * also loses the capitalisation that made "InfiniteTag" one word.
 */
const BUTTON_SX = { textTransform: 'none' } as const;

type StepActions = ProviderSetupGuideProps['actions'];

/** A step's sentence, with the provider's own reference inline after it. */
function StepText({ text, link }: { text?: string; link?: SetupStep['link'] }) {
  if (!text) return null;
  return (
    <Typography sx={{ fontSize: '13px', color: T.ink2, lineHeight: 1.5 }}>
      {richText(text)}{' '}
      {link ? (
        <Link href={link.url} target="_blank" rel="noreferrer">
          {link.label}
        </Link>
      ) : null}
    </Typography>
  );
}

/**
 * The panel's action bar: what this step is asking, and the button that answers.
 *
 * The sentence is not decoration. This is the one step no API can report, so
 * the owner is being asked to vouch for work done somewhere else — and a bare
 * button gives them nothing to weigh that against.
 */
function ConfirmBar({ action }: { action: { label: string; run: () => void } }) {
  return (
    <Box sx={BAR_SX} data-testid="payments-setup-confirm-bar">
      <Typography sx={BAR_MSG_SX}>Confirme quando terminar do lado do provedor.</Typography>
      <Button variant="contained" disableElevation sx={BTN_PRIMARY_SX} onClick={() => action.run()}>
        {action.label}
      </Button>
    </Box>
  );
}

interface StepRowProps {
  step: SetupStep;
  actions: StepActions;
}

/**
 * The numbers an owner reads, which are not the array indices.
 *
 * Warnings sit between instructions and carry no number of their own, so
 * numbering by position would print "1, 3" and skip a step that was never
 * there. Counted rather than indexed.
 */
/**
 * A step that warns rather than instructs.
 *
 * Un-numbered on purpose: it is not a thing to DO, and numbering it made the
 * two most important sentences in InfinitePay's walkthrough — the tag decides
 * who gets paid, and the page we link to can also change it — read as further
 * instructions BELOW the button that had already taken the owner there.
 */
function WarningRow({ text }: { text: string }) {
  return (
    <Alert severity="warning" data-testid="payments-setup-warning">
      <Typography variant="body2">{richText(text)}</Typography>
    </Alert>
  );
}

function StepRow({ step, actions }: StepRowProps) {
  const action = step.action ? actions?.[step.action] : undefined;
  if (step.tone === 'warning') return <WarningRow text={step.text ?? ''} />;
  // An action-only step IS the panel's action bar — see `SectionCard`.
  if (action && !step.text) return <ConfirmBar action={action} />;
  // A bordered row with the work on the left and the way to do it on the
  // right, so a step reads as a thing to tick off rather than as a paragraph.
  // The instructions on this screen are a CHECKLIST — each one is a piece of
  // work the owner does somewhere else and comes back from.
  return (
    <Stack
      direction="row"
      gap="12px"
      alignItems="flex-start"
      sx={{ border: `1px solid ${T.line}`, borderRadius: '9px', px: '14px', py: '12px' }}
    >
      <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
        <StepText text={step.text} link={step.link} />
      {action ? (
        <Box>
          <Button variant="contained" size="small" sx={BUTTON_SX} onClick={() => void action.run()}>
            {action.label}
          </Button>
        </Box>
      ) : null}
        {step.copy ? (
          <CopyField
            label={step.copy.label}
            text={step.copy.text}
            collapsible={step.copy.collapsible}
          />
        ) : null}
      </Stack>
      {step.button ? (
        <Button
          size="small"
          href={step.button.url}
          target="_blank"
          rel="noreferrer"
          sx={{ ...BTN_SECONDARY_SX, px: '12px', py: '7px', fontSize: '12px', flexShrink: 0 }}
          // The mark is the promise: this leaves the store and opens the
          // provider's site. A button that reads the same as the in-page ones
          // and then navigates away is a small betrayal, and here it lands on
          // a screen that can CHANGE where the money goes.
          endIcon={
            <Box component="span" aria-hidden sx={{ fontSize: '0.9em' }}>
              ↗
            </Box>
          }
        >
          {step.button.label}
        </Button>
      ) : null}
    </Stack>
  );
}

/**
 * The numbered dot: 24px, filled once the store is ON or PAST the step.
 *
 * MUI's own icon is a 24px circle with the number inside and the same fill for
 * active and completed, which is nearly the prototype — the differences are the
 * exact greys and the ✓ on a finished step, and on a screen whose whole job is
 * "where am I" those are the two things that carry the answer.
 */
function StageIcon({ active, completed, icon }: StepIconProps) {
  const filled = active || completed;
  return (
    <Box
      sx={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: filled ? T.brand : '#d9dbe1',
        color: '#fff',
        fontSize: '12px',
        fontWeight: 700,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {completed ? '✓' : icon}
    </Box>
  );
}

/** A 2px rule that turns brand-coloured behind the steps already passed. */
const StageConnector = styled(StepConnector)({
  top: 11,
  [`& .${stepConnectorClasses.line}`]: { borderTopWidth: 2, borderColor: T.line },
  [`&.${stepConnectorClasses.active} .${stepConnectorClasses.line}`]: { borderColor: T.brandLine },
  [`&.${stepConnectorClasses.completed} .${stepConnectorClasses.line}`]: {
    borderColor: T.brandLine,
  },
});

const STAGE_LABEL_SX = {
  '& .MuiStepLabel-label': {
    fontSize: '12px',
    color: T.ink3,
    lineHeight: 1.25,
    mt: '7px !important',
    '&.Mui-active': { color: T.ink, fontWeight: 650 },
    '&.Mui-completed': { color: T.ink3, fontWeight: 400 },
  },
} as const;

export function ProviderSetupGuide({
  guide,
  activeStage = 0,
  actions,
  beforeSections,
  sectionFooter,
}: ProviderSetupGuideProps) {
  return (
    <Stack spacing={0} data-testid="payments-setup-guide">
      <Stepper
        activeStep={activeStage}
        alternativeLabel
        connector={<StageConnector />}
        sx={{ px: '20px', pt: '6px', pb: '18px' }}
      >
        {guide.stages.map((stage, index) => (
          <Step key={stage.id} completed={index < activeStage}>
            <StepLabel slots={{ stepIcon: StageIcon }} sx={STAGE_LABEL_SX}>
              {stage.label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>
      {beforeSections}
      {guide.sections.map((section) => (
        <SectionCard key={section.id} section={section} actions={actions} footer={sectionFooter} />
      ))}
    </Stack>
  );
}

function SectionCard({
  section,
  actions,
  footer,
}: {
  section: SetupSection;
  actions: StepActions;
  footer?: ReactNode;
}) {
  // The step whose completion only the OWNER can report is not a row among the
  // instructions — it is what this panel is FOR. It moves to the action bar, so
  // the control the owner is working toward is the last thing in the block and
  // stays on screen while they read the steps above it.
  const asks = section.steps.filter((step) => step.action !== undefined);
  const reads = section.steps.filter((step) => step.action === undefined);

  return (
    <Box
      sx={PANEL_SX}
      // Which section is showing is now a FACT about the store's progress, not
      // a constant, so it needs to be assertable by id rather than by matching
      // the prose inside it.
      data-testid={`payments-setup-section-${section.id}`}
    >
      <Box sx={{ px: '18px', pt: '15px' }}>
        <Typography sx={{ fontSize: '14.5px', fontWeight: 700, color: T.ink }}>
          {section.title}
        </Typography>
        {section.intro ? (
          <Typography sx={{ fontSize: '12.5px', color: T.ink3, mt: '5px', lineHeight: 1.5 }}>
            {richText(section.intro)}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ px: '18px', pt: '14px', pb: '18px' }}>
        <Stack spacing={1.5}>
          {reads.map((step, index) => (
            <StepRow key={index} step={step} actions={actions} />
          ))}
          {footer}
        </Stack>
      </Box>
      {asks.map((step, index) => (
        <StepRow key={`ask-${index}`} step={step} actions={actions} />
      ))}
    </Box>
  );
}
