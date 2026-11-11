"use client";

import { useCallback, useContext, useState, type Dispatch, type JSX, type SetStateAction } from "react";

import { FormContainer, FormErrorSnackbar } from "@12-apps/ui/form/total-form";

import type { DiscountSchedule } from "../engine/schedule";
import type { ComboRequirement } from "../engine/types";

import type { DiscountFormPayload, DiscountsApiClient, DiscountWireRecord, WireTargetGroup } from "./api";
import type { CompleteDiscountsWebCopy } from "./copy";
import type { DiscountsTimeZoneSettings } from "./days-unknown-notice";
import { DirtyReportContext } from "./discount-dialog";
import type { CurrencyFieldComponent } from "./discount-form-fields";
import { DiscountStepForm } from "./discount-step-form";
import { blankWindow } from "./schedule-builder";
import { validate, type FormTargets } from "./discount-form-validate";
import { formDatesLock, initialValues, type DatesLock, type DiscountFormValues } from "./discount-form-values";
import { typeAndScopeFor } from "./form-kind";
import type { DiscountsFormatters } from "./format";
import { NO_SERVER_ERRORS, serverErrorsOf, type ServerErrors } from "./step-effects";
import { flowRefused, initialFlow, type StepFlow } from "./step-flow";
import { stepOfKey, type StepNumber } from "./step-keys";

/**
 * The create/edit form — shared by the header's create dialog and the row
 * menu's edit dialog, so the fields and the submit live in one place.
 * `editing === null` creates; otherwise it re-states the rule whole.
 *
 * Two kinds of value are deliberately NOT `total-form` values, for one reason:
 * `total-form` holds STRINGS. The two switches (booleans) and the target id
 * lists (arrays) sit in local state beside the container and are merged in at
 * submit.
 *
 * Every rule checked here is ALSO checked on the server. This half exists for
 * the operator's sake — instant, field-attached feedback — never as the
 * authority: the surface re-validates, and a server refusal comes back through
 * `setFieldErrors` and paints the same inputs red.
 */

/** A stored rule's first-purchase switch (FUT-2825); off for a new rule and an older record. */
function savedFirstOrderOnly(editing: DiscountWireRecord | null): boolean {
  return editing !== null && editing.firstOrderOnly === true;
}

/** The values `total-form` cannot hold, kept beside it and merged at submit. */
function useNonStringState(editing: DiscountWireRecord | null) {
  const [active, setActive] = useState<boolean>(editing?.active ?? true);
  const [stackable, setStackable] = useState<boolean>(editing?.stackable ?? true);
  const [firstOrderOnly, setFirstOrderOnly] = useState<boolean>(() => savedFirstOrderOnly(editing));
  const [categoryIds, setCategoryIds] = useState<string[]>(editing?.categoryIds ?? []);
  const [menuItemIds, setMenuItemIds] = useState<string[]>(editing?.menuItemIds ?? []);
  // The combo's groups are the third array, and the one whose ORDER matters:
  // the list the operator built is the list a card reads back, and the server
  // stamps each group's index as its stored `position`.
  const [comboRequirements, setComboRequirements] = useState<ComboRequirement[]>(() =>
    editing?.comboRequirements ? [...editing.comboRequirements] : [],
  );
  // The weekly schedule (FUT-996) is the fourth: a nested structure edited with
  // chips and clocks, which `total-form`'s strings cannot hold.
  //
  // Its ON/OFF is kept SEPARATE from its contents on purpose. An operator who
  // switches back to "Sempre" and then changes their mind has not lost the days
  // they picked — the rows survive the toggle and only the SUBMIT reads the
  // switch. Collapsing the two would make the radio destructive.
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(
    () => (editing?.schedule?.windows.length ?? 0) > 0,
  );
  const [schedule, setSchedule] = useState<DiscountSchedule>(() =>
    editing?.schedule && editing.schedule.windows.length > 0
      ? { windows: editing.schedule.windows.map((w) => ({ ...w, days: [...w.days] })) }
      : { windows: [blankWindow()] },
  );
  return {
    active,
    stackable,
    firstOrderOnly,
    categoryIds,
    menuItemIds,
    comboRequirements,
    scheduleEnabled,
    schedule,
    setActive,
    setStackable,
    setFirstOrderOnly,
    setCategoryIds,
    setMenuItemIds,
    setComboRequirements,
    setScheduleEnabled,
    setSchedule,
  };
}

type NonStringState = ReturnType<typeof useNonStringState>;

/** What a submit tells the steps: a new try, the client's refusal, the server's. */
interface SubmitHooks {
  setError: (message: string | null) => void;
  setFlow: Dispatch<SetStateAction<StepFlow>>;
  setServer: Dispatch<SetStateAction<ServerErrors>>;
}

/** The steps a map of field errors belongs to; keys the table does not list have none. */
function stepsOf(errors: Readonly<Record<string, string | undefined>>): StepNumber[] {
  return Object.keys(errors).flatMap((key) => {
    const step = stepOfKey(key);
    return step === null || errors[key] === undefined ? [] : [step];
  });
}

export interface DiscountFormProps {
  api: DiscountsApiClient;
  copy: CompleteDiscountsWebCopy;
  formatters: DiscountsFormatters;
  currencyField: CurrencyFieldComponent;
  groups: readonly WireTargetGroup[];
  editing: DiscountWireRecord | null;
  onSaved: () => void;
  /** Where a refused or failed write is reported, beyond the operator's screen. */
  onError: (error: unknown, context: string) => void;
  /** The store's timezone as a person says it — shown under the clocks. */
  timezoneLabel?: string;
  /**
   * Whether the server counts Início and Término WHOLE in the store's zone
   * (its `storeTimeZone`, FUT-4482): equal days are then a one-day promotion.
   * Default false, which refuses equal days as such a server does.
   */
  wholeDays?: boolean;
  /** The host's link to its time-zone setting, for the "days unknown" notice. */
  timeZoneSettings?: DiscountsTimeZoneSettings;
  /**
   * The server said the store's zone is unknown now (the list's `datesLocked`,
   * FUT-4482, CP8). Read on a create only — an edit reads its own row: the
   * period is shown locked and empty, and the create saves no dates, since a
   * dated one would be refused. Default false.
   */
  zoneUnknown?: boolean;
  /**
   * Whether the values differ from those the form opened with (FUT-4478): a
   * host embedding the form guards its own way out with it. `DiscountDialog`
   * hears it without this prop and guards its close itself.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * An edit whose dates are the ones it opened with (review round 9, N4): the
 * stored window is kept (`keepWindow`) rather than re-sent as days. Where the
 * server counts whole days its zone can turn unknown while the form is open,
 * and re-sent days would then be refused on the date field — a save the
 * operator never asked to change the dates of, refused for them. Kept, the
 * save needs no clock; under a known zone the server wrote the same stored
 * window for equal days anyway. Only with `wholeDays`: elsewhere no zone is
 * ever asked, and the body stays as it always was.
 */
function keepsUnchangedDays(props: DiscountFormProps, values: DiscountFormValues): boolean {
  if (props.editing === null || props.wholeDays !== true) return false;
  const opened = initialValues(props.editing, props.formatters);
  return values.startsAt === opened.startsAt && values.endsAt === opened.endsAt;
}

/**
 * What a save does with the period. Days the form cannot change (FUT-4482):
 * none shown (`daysUnknown`, and empty boxes sent would read as "sem prazo"),
 * or shown and locked while the store's zone is unknown (round 8). They are
 * not sent; everything else is saved over the stored window (`keepWindow`),
 * never refused. A create under that zone (CP8) has no stored window: it
 * sends no dates and saves open-ended.
 */
function windowIntent(
  props: DiscountFormProps,
  values: DiscountFormValues,
): { locked: boolean; keepWindow: boolean; noDates: Partial<DiscountFormValues> } {
  const lock = formDatesLock(props.editing, props.zoneUnknown === true);
  if (lock === "create") return { locked: true, keepWindow: false, noDates: { startsAt: "", endsAt: "" } };
  return { locked: lock !== null, keepWindow: lock !== null || keepsUnchangedDays(props, values), noDates: {} };
}

/**
 * Build the submit handler.
 *
 * A factory rather than a closure inside the component, so the component stays
 * inside the size gate and the validate → send → attribute-the-failure sequence
 * reads as one block.
 */
function makeSubmit(
  props: DiscountFormProps,
  extra: NonStringState,
  hooks: SubmitHooks,
): (values: DiscountFormValues) => Promise<void> {
  const { api, copy, formatters, editing, onSaved, onError } = props;
  return async function handleSubmit(values): Promise<void> {
    hooks.setError(null);
    hooks.setServer((previous) => ({ ...previous, refused: false }));
    const { locked, keepWindow, noDates } = windowIntent(props, values);
    const targets: FormTargets = {
      categoryIds: extra.categoryIds,
      menuItemIds: extra.menuItemIds,
      comboRequirements: extra.comboRequirements,
    };
    const invalid = validate(values, targets, formatters, copy, {
      enabled: extra.scheduleEnabled,
      schedule: extra.schedule,
      wholeDays: props.wholeDays ?? false,
      datesLocked: locked,
    });
    if (Object.keys(invalid).length > 0) {
      // The submit is held while anything is missing, so this is the backstop:
      // every step at fault is tried — its messages show — and the first opens.
      hooks.setFlow((flow) => flowRefused(flow, stepsOf(invalid)));
      return;
    }
    const payload: DiscountFormPayload = {
      ...values,
      ...noDates,
      // The switch decides whether the rows are sent at all — see the state
      // hook for why the two are separate.
      schedule: extra.scheduleEnabled ? extra.schedule : null,
      // The one place the form's question becomes the API's two columns. Every
      // other consumer — the write path, the evaluator, the CHECK constraints —
      // still sees the `type`/`scope` pair it always did.
      ...typeAndScopeFor(values),
      ...targets,
      stackable: extra.stackable,
      firstOrderOnly: extra.firstOrderOnly,
      active: extra.active,
      ...(keepWindow ? { keepWindow } : {}),
    };
    const result = editing
      ? await api.update(editing.id, payload)
      : await api.create(payload);
    if (result.ok) {
      onSaved();
      return;
    }
    hooks.setError(result.error);
    // The server attributes what it can — a duplicate code, a rate out of range
    // — so those inputs say it, on their steps, kept apart from the client's
    // rules until the field they name changes (FUT-4478).
    const fieldErrors = result.fieldErrors;
    if (fieldErrors) {
      const form = { values, ...extra, slots: extra.comboRequirements };
      hooks.setServer((previous) => serverErrorsOf(fieldErrors, form, previous.round + 1));
      hooks.setFlow((flow) => flowRefused(flow, stepsOf(fieldErrors)));
    }
    onError(result, editing ? "discounts.update" : "discounts.create");
  };
}

/**
 * What "Quando vale" is told about the server: whether it counts whole days,
 * whether it could place the edited rule's days (FUT-4482), and its zone's name.
 */
function windowFlags(props: DiscountFormProps): {
  wholeDays: boolean;
  datesLock: DatesLock;
  timezoneLabel: string | null;
  timeZoneSettings: DiscountsTimeZoneSettings | undefined;
} {
  return {
    wholeDays: props.wholeDays ?? false,
    datesLock: formDatesLock(props.editing, props.zoneUnknown === true),
    timezoneLabel: props.timezoneLabel ?? null,
    timeZoneSettings: props.timeZoneSettings,
  };
}

export function DiscountForm(props: DiscountFormProps): JSX.Element {
  const { copy, formatters, currencyField, groups, editing } = props;
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<StepFlow>(() => initialFlow(editing !== null));
  const [server, setServer] = useState<ServerErrors>(NO_SERVER_ERRORS);
  const extra = useNonStringState(editing);
  const handleSubmit = makeSubmit(props, extra, { setError, setFlow, setServer });
  const report = useContext(DirtyReportContext);
  const { onDirtyChange } = props;
  const onDirty = useCallback(
    (dirty: boolean) => {
      onDirtyChange?.(dirty);
      report?.(dirty);
    },
    [onDirtyChange, report],
  );

  return (
    <FormContainer<DiscountFormValues>
      // No `schema`: the container runs one before `onSubmit` and stops when
      // it fails, which judged the name alone. Every rule, the name's too,
      // lives in `validate` so one Criar marks every field (FUT-4143).
      initialValues={initialValues(editing, formatters)}
      onSubmit={handleSubmit}
      dataTestId="discount-form"
    >
      <DiscountStepForm
        copy={copy}
        formatters={formatters}
        currencyField={currencyField}
        groups={groups}
        editing={editing !== null}
        extra={extra}
        window={windowFlags(props)}
        datesLocked={windowIntent(props, initialValues(editing, formatters)).locked}
        flow={flow}
        setFlow={setFlow}
        server={server}
        setServer={setServer}
        error={error}
        onDirtyChange={onDirty}
      />
      {/* Only after the SERVER refused the last submit: a step's live errors are its own to show (FUT-4477). */}
      <FormErrorSnackbar message={copy.form.errorSnackbar} show={server.refused} />
    </FormContainer>
  );
}
