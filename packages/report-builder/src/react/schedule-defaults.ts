import type { ReportBuilderCopy } from "./copy";
import { EN_US_REPORT_SCHEDULE_COPY } from "./en-US.schedule";
import { PT_BR_REPORT_SCHEDULE_COPY } from "./pt-BR.schedule";
import type { ReportScheduleCopy, ResolvedScreensCopy } from "./schedule-copy";

/** The package's own delivery words for a pack's locale: Portuguese for `pt*`, English otherwise. */
export function defaultScheduleCopy(locale: string): ReportScheduleCopy {
  return locale.toLowerCase().startsWith("pt") ? PT_BR_REPORT_SCHEDULE_COPY : EN_US_REPORT_SCHEDULE_COPY;
}

export type ResolvedReportBuilderCopy = Omit<ReportBuilderCopy, "screens"> & { screens: ResolvedScreensCopy };

/**
 * Fill in the delivery words a host's pack does not carry (FUT-776), from the
 * locale its engine pack declares, so adding the feature is not a breaking
 * change to the copy contract. A pack that has them wins.
 */
export function withScheduleDefaults(copy: ReportBuilderCopy): ResolvedReportBuilderCopy {
  const { screens } = copy;
  const schedule = screens.settings.schedule ?? defaultScheduleCopy(copy.engine.spec.locale);
  return {
    ...copy,
    screens: {
      ...screens,
      settings: { ...screens.settings, schedule },
      editor: { ...screens.editor, needsRecipient: screens.editor.needsRecipient ?? schedule.needsRecipient },
    },
  };
}
