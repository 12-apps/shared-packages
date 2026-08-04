'use client';

import {
  Alert,
  Box,
  Button,
  IconButton,
  Link,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';

import type { ProviderSetupGuide as Guide, SetupSection, SetupStep } from '@12-apps/payments-backend';

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
  return (
    <Stack spacing={1}>
      {step.text ? (
        <Typography variant="body2">
          {richText(step.text)}{' '}
          {step.link ? (
            <Link href={step.link.url} target="_blank" rel="noreferrer">
              {step.link.label}
            </Link>
          ) : null}
        </Typography>
      ) : null}
      {step.button ? (
        <Box>
          <Button
            variant="outlined"
            size="small"
            href={step.button.url}
            target="_blank"
            rel="noreferrer"
            sx={BUTTON_SX}
            // The mark is the promise: this leaves the store and opens the
            // provider's site. A button that reads the same as the in-page ones
            // and then navigates away is a small betrayal, and here it lands on
            // a screen that can CHANGE the tag.
            endIcon={<Box component="span" aria-hidden sx={{ fontSize: '0.9em' }}>↗</Box>}
          >
            {step.button.label}
          </Button>
        </Box>
      ) : null}
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
  );
}

export function ProviderSetupGuide({
  guide,
  activeStage = 0,
  actions,
  beforeSections,
  sectionFooter,
}: ProviderSetupGuideProps) {
  return (
    <Stack spacing={3} data-testid="payments-setup-guide">
      <Stepper activeStep={activeStage} alternativeLabel>
        {guide.stages.map((stage) => (
          <Step key={stage.id}>
            <StepLabel>{stage.label}</StepLabel>
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
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2 }}
      // Which section is showing is now a FACT about the store's progress, not
      // a constant, so it needs to be assertable by id rather than by matching
      // the prose inside it.
      data-testid={`payments-setup-section-${section.id}`}
    >
      <Stack spacing={2}>
        <Typography variant="subtitle1" fontWeight="bold">
          {section.title}
        </Typography>
        {section.intro ? (
          <Typography variant="body2" color="text.secondary">
            {richText(section.intro)}
          </Typography>
        ) : null}
        {section.steps.map((step, index) => (
          <StepRow key={index} step={step} actions={actions} />
        ))}
        {footer}
      </Stack>
    </Paper>
  );
}
