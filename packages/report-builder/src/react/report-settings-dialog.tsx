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
import { Textarea } from "@12-apps/ui/form/Textarea";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { alpha } from "@12-apps/ui/mui/styles";
import { Text } from "@12-apps/ui/typography/Text";

import type { ReportStatusWire, ReportVisibilityWire } from "./custom-reports-api";
import { RolesAllowlist, type PublishDraft } from "./lib/publish-section";
import { DefaultRangeField, Field } from "./lib/settings-fields";
import type { ReportRollingRange } from "./reports-api";
import { CONTAINER_RADIUS_PX, CONTROL_RADIUS_PX } from "./lib/report-surface";
import type { ReportSettingsCopy } from "./screens-copy";
import { useReportCopy } from "./transport-context";

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

function statusCards(copy: ReportSettingsCopy): Array<ChoiceCard<ReportStatusWire>> {
  return (["published", "draft"] as const).map((value) => ({
    value,
    title: copy.statusCards[value]?.title ?? "",
    description: copy.statusCards[value]?.description ?? "",
  }));
}

function visibilityCards(copy: ReportSettingsCopy): Array<ChoiceCard<ReportVisibilityWire>> {
  return (["private", "tenant", "roles"] as const).map((value) => ({
    value,
    title: copy.visibilityCards[value]?.title ?? "",
    description: copy.visibilityCards[value]?.description ?? "",
  }));
}

interface ReportSettingsValue {
  name: string;
  description: string;
  publish: PublishDraft;
  /** The period the saved report opens on — a real column (FUT-755). */
  defaultRange: ReportRollingRange;
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
  const copy = useReportCopy().screens.settings;
  return (
    <>
      <Field label="Status">
        <Stack spacing={0.75}>
          {statusCards(copy).map((option) => (
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
          {visibilityCards(copy).map((option) => (
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
  const copy = useReportCopy().screens.settings;
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
      <Text variant="heading" size="lg" weight="semibold" as="h2">
        {copy.title}
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
  const copy = useReportCopy().screens.settings;
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
        label={copy.descriptionLabel}
        variant="autosize"
        // `sm`, not the default `md`: the default carries a 100px floor and
        // grew the field to a third of the dialog for a one-line description.
        size="sm"
        minRows={3}
        placeholder={copy.descriptionPlaceholder}
        helperText={copy.descriptionHelper}
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
  const copy = useReportCopy().screens.settings;
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

          <DefaultRangeField
            value={value.defaultRange}
            onChange={(defaultRange) => onChange({ ...value, defaultRange })}
            testId={`${testId}-default-range`}
          />

          {/* FUT-776 — scheduled e-mail delivery of a saved report. Shown
              because the setting belongs here and hiding it would make the
              dialog disagree with the design; inert because there is no
              column, no job and no address list behind it yet. */}
          <ComingSoonRow
            label={copy.scheduleLabel}
            value={copy.scheduleValue}
            reason={copy.scheduleReason}
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
