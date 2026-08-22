import type { ReportEngineCopy } from "../copy";
import type { BlankBlockTemplateCopy } from "../server/block-templates";
import type { ReportScreensCopy } from "./screens-copy";

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
  /**
   * What the SCREENS say — the list, the editor, the viewer, the settings
   * dialog, the built-in dashboards. A separate file because it is a hundred
   * keys of prose and this one is the config contract.
   */
  screens: ReportScreensCopy;
}
