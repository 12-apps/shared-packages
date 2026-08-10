/**
 * "Ajustes do relatório" (GAP 8) — everything ABOUT the report, as opposed to
 * what is on it.
 *
 * Name, description, lifecycle and sharing used to sit inline at the top of the
 * editor as four stacked form controls, so the first screen of composing a
 * report was a form and the canvas began below the fold. `prototype.html` puts
 * them behind one ⚙ and leaves the page to the report: the header carries the
 * name (editable in place) and everything else is one click away.
 *
 * Nothing here invents storage. Name, description, status, visibility and the
 * period the report opens on are all real columns with the existing save path
 * behind them. The one control the prototype shows that this product has no
 * schema for — the weekly e-mail — is rendered REFUSED-with-a-reason rather
 * than faked (see {@link ComingSoonRow}).
 */
import type { JSX } from "react";

import { Modal, ModalContent } from "@12-apps/ui/feedback/Modal";
import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Select } from "@12-apps/ui/form/Select";
import { Textarea } from "@12-apps/ui/form/Textarea";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { alpha } from "@12-apps/ui/mui/styles";
import { Text } from "@12-apps/ui/typography/Text";

import type { ReportStatusWire, ReportVisibilityWire } from "./custom-reports-api";
import { RolesAllowlist, type PublishDraft } from "./lib/publish-section";
import { REPORT_RANGES, type ReportRange } from "./reports-api";
import { CONTAINER_RADIUS_PX, CONTROL_RADIUS_PX, SECTION_LABEL_STYLE } from "./lib/report-surface";

/**
 * A radio CARD: the control, a bold title, and the line that says what the
 * choice means. A `<select>` cannot carry that line, which is why the two
 * selects this replaces made "Rascunho" and "Somente autor e admins" read as
 * jargon to choose between rather than two clearly different outcomes.
 */
const RADIO_CARD_SX = {
  display: "flex",
  gap: 1.25,
  alignItems: "flex-start",
  p: 1.25,
  border: "1px solid",
  borderColor: "divider",
  borderRadius: `${CONTAINER_RADIUS_PX}px`,
  cursor: "pointer",
  transition: "border-color .12s, background-color .12s",
  "&:hover": { bgcolor: "action.hover" },
} as const;

const RADIO_CARD_SELECTED_SX = {
  borderColor: "primary.main",
  bgcolor: (theme: { palette: { primary: { main: string } } }) =>
    alpha(theme.palette.primary.main, 0.06),
} as const;

function RadioCard({
  name,
  value,
  selected,
  title,
  description,
  testId,
  onSelect,
}: {
  /** The radio GROUP — what makes these mutually exclusive to the browser. */
  name: string;
  value: string;
  selected: boolean;
  title: string;
  description: string;
  testId: string;
  onSelect: () => void;
}): JSX.Element {
  return (
    <Box
      component="label"
      data-testid={testId}
      sx={{ ...RADIO_CARD_SX, ...(selected ? RADIO_CARD_SELECTED_SX : {}) }}
    >
      <Box
        component="input"
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={onSelect}
        sx={{ mt: "2px", accentColor: "primary.main", flex: "none", width: 16, height: 16 }}
      />
      <Stack spacing={0.25}>
        <Text variant="body" size="sm" weight="semibold">
          {title}
        </Text>
        <Text variant="body" size="xs" color="secondary">
          {description}
        </Text>
      </Stack>
    </Box>
  );
}

/** One labelled block inside the dialog — the eyebrow plus whatever it labels. */
function Field({
  label,
  children,
}: {
  label: string;
  children: JSX.Element | JSX.Element[];
}): JSX.Element {
  return (
    <Stack spacing={0.75}>
      <Text variant="heading" size="xs" color="secondary" as="h3" style={SECTION_LABEL_STYLE}>
        {label}
      </Text>
      {children}
    </Stack>
  );
}

/**
 * A control the prototype shows and this product cannot yet honour.
 *
 * `aria-disabled` rather than `disabled`: a disabled control is unfocusable and
 * has no hover, so the very sentence explaining WHY it does nothing would be
 * the one thing a keyboard user could never reach.
 */
function ComingSoonRow({
  label,
  value,
  reason,
  testId,
}: {
  label: string;
  /** What it will say when it works — shown, inert, so the shape is honest. */
  value: string;
  /** Why it does nothing, naming the ticket that will make it do something. */
  reason: string;
  testId: string;
}): JSX.Element {
  return (
    <Field label={label}>
      <Box
        role="group"
        aria-disabled="true"
        aria-describedby={`${testId}-reason`}
        tabIndex={0}
        data-testid={testId}
        sx={{
          p: 1.25,
          border: "1px dashed",
          borderColor: "divider",
          borderRadius: `${CONTROL_RADIUS_PX}px`,
          color: "text.disabled",
        }}
      >
        <Text variant="body" size="sm" color="secondary">
          {value}
        </Text>
      </Box>
      <Text variant="body" size="xs" color="secondary" id={`${testId}-reason`}>
        {reason}
      </Text>
    </Field>
  );
}

interface ChoiceCard<T> {
  value: T;
  title: string;
  description: string;
}

const STATUS_CARDS: Array<ChoiceCard<ReportStatusWire>> = [
  { value: "published", title: "Publicado", description: "Aparece na lista para quem tem acesso." },
  { value: "draft", title: "Rascunho", description: "Só você vê, mesmo que compartilhado." },
];

const VISIBILITY_CARDS: Array<ChoiceCard<ReportVisibilityWire>> = [
  { value: "private", title: "Só você", description: "Ninguém mais da loja vê." },
  {
    value: "tenant",
    title: "Toda a equipe",
    description: "Qualquer pessoa com acesso ao admin da loja.",
  },
  {
    value: "roles",
    title: "Cargos específicos",
    description:
      "Campos de custo continuam ocultos para quem não tem permissão, qualquer que seja o cargo.",
  },
];

interface ReportSettingsValue {
  name: string;
  description: string;
  publish: PublishDraft;
  /** The period the saved report opens on — a real column (FUT-755). */
  defaultRange: ReportRange;
}

/**
 * Longer labels than the editor's range toggle, on purpose: a toggle reads in
 * context ("30 dias"), a select in a settings list has to say what it is
 * choosing without it, and `prototype.html` writes it out the same way. No
 * `Personalizado…` — a stored preference has nowhere to keep explicit dates.
 */
const DEFAULT_RANGE_OPTIONS: Array<{ value: ReportRange; label: string }> = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
];

/** Guard the wire's word before it reaches state — a stale value opens nothing. */
function asReportRange(value: string): ReportRange {
  return REPORT_RANGES.find((candidate) => candidate === value) ?? "30d";
}

/** The two radio groups, so the dialog's own body stays a list of fields. */
function SharingFields({
  tenantSlug,
  publish,
  onPublishChange,
  testId,
}: {
  tenantSlug: string;
  publish: PublishDraft;
  onPublishChange: (next: PublishDraft) => void;
  testId: string;
}): JSX.Element {
  return (
    <>
      <Field label="Status">
        <Stack spacing={0.75}>
          {STATUS_CARDS.map((option) => (
            <RadioCard
              key={option.value}
              name={`${testId}-status`}
              value={option.value}
              selected={publish.status === option.value}
              title={option.title}
              description={option.description}
              testId={`${testId}-status-${option.value}`}
              onSelect={() => onPublishChange({ ...publish, status: option.value })}
            />
          ))}
        </Stack>
      </Field>

      <Field label="Quem pode ver">
        <Stack spacing={0.75}>
          {VISIBILITY_CARDS.map((option) => (
            <RadioCard
              key={option.value}
              name={`${testId}-visibility`}
              value={option.value}
              selected={publish.visibility === option.value}
              title={option.title}
              description={option.description}
              testId={`${testId}-visibility-${option.value}`}
              onSelect={() => onPublishChange({ ...publish, visibility: option.value })}
            />
          ))}
          {publish.visibility === "roles" ? (
            <RolesAllowlist tenantSlug={tenantSlug} value={publish} onChange={onPublishChange} />
          ) : null}
        </Stack>
      </Field>
    </>
  );
}

/** The dialog's own title row, with the × that closes it. */
function DialogHeader({ testId, onClose }: { testId: string; onClose: () => void }): JSX.Element {
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
      <Text variant="heading" size="lg" weight="semibold" as="h2">
        Ajustes do relatório
      </Text>
      <Box sx={{ flex: 1 }} />
      <Button
        variant="ghost"
        color="neutral"
        size="sm"
        aria-label="Fechar"
        onClick={onClose}
        dataTestId={`${testId}-close`}
      >
        ✕
      </Button>
    </Stack>
  );
}

/** What the report is CALLED, and what it is for. */
function IdentityFields({
  testId,
  value,
  onChange,
}: {
  testId: string;
  value: ReportSettingsValue;
  onChange: (next: ReportSettingsValue) => void;
}): JSX.Element {
  return (
    <>
      <Input
        label="Nome"
        value={value.name}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
        data-testid={`${testId}-name`}
      />
      {/* Keeps the id the inline field carried, so nothing that already
          addresses the description has to learn a new name — it moved, it did
          not disappear. */}
      <Textarea
        label="Descrição"
        variant="autosize"
        // `sm`, not the default `md`: the default carries a 100px floor and
        // grew the field to a third of the dialog for a one-line description.
        size="sm"
        minRows={3}
        placeholder="Para que serve este relatório?"
        helperText="Aparece no card da lista — ajuda a equipe a achar o certo."
        value={value.description}
        onChange={(event) => onChange({ ...value, description: event.target.value })}
        data-testid="report-editor-description"
      />
    </>
  );
}

export function ReportSettingsDialog({
  open,
  tenantSlug,
  value,
  onChange,
  onClose,
  testId = "report-settings",
}: {
  open: boolean;
  tenantSlug: string;
  value: ReportSettingsValue;
  onChange: (next: ReportSettingsValue) => void;
  onClose: () => void;
  testId?: string;
}): JSX.Element {
  return (
    <Modal open={open} onClose={onClose} size="sm" dataTestId={testId}>
      <ModalContent dataTestId={`${testId}-content`}>
        <Stack spacing={2.5}>
          <DialogHeader testId={testId} onClose={onClose} />
          <IdentityFields testId={testId} value={value} onChange={onChange} />

          <SharingFields
            tenantSlug={tenantSlug}
            publish={value.publish}
            onPublishChange={(publish) => onChange({ ...value, publish })}
            testId={testId}
          />

          <Field label="Período padrão ao abrir">
            <Select
              aria-label="Período padrão ao abrir"
              options={DEFAULT_RANGE_OPTIONS}
              value={value.defaultRange}
              onChange={(event) =>
                onChange({ ...value, defaultRange: asReportRange(String(event.target.value)) })
              }
              size="sm"
              data-testid={`${testId}-default-range`}
            />
          </Field>

          {/* FUT-776 — scheduled e-mail delivery of a saved report. Shown
              because the setting belongs here and hiding it would make the
              dialog disagree with the design; inert because there is no
              column, no job and no address list behind it yet. */}
          <ComingSoonRow
            label="Envio automático"
            value="Enviar por e-mail toda segunda, 8h"
            reason="Em breve (FUT-776) — ainda não é possível agendar o envio."
            testId={`${testId}-schedule`}
          />

          <Button
            variant="solid"
            size="md"
            onClick={onClose}
            sx={{ width: "100%" }}
            dataTestId={`${testId}-done`}
          >
            Concluir
          </Button>
        </Stack>
      </ModalContent>
    </Modal>
  );
}
