import type { ReportEngineCopy } from "../copy";
import type { BlankBlockTemplateCopy } from "../server/block-templates";

/**
 * Every word this surface renders, as REQUIRED host config (FUT-760).
 *
 * Two halves, because they are sourced differently. `engine` is the same object
 * the SERVER half takes — a host running reports on both sides passes one
 * constant to both, so a column heading cannot read one way in an export and
 * another on screen. `blankTemplate` is the picker's one package-shipped entry,
 * which is copy for the same reason and belongs nowhere else.
 */
export interface ReportBuilderCopy {
  engine: ReportEngineCopy;
  blankTemplate: BlankBlockTemplateCopy;
}
