import type { ReportBuilderSurface } from '../transport-context';

/**
 * The host vocabulary a screen test mounts the surface with.
 *
 * EMPTY of built-ins on purpose. These suites exercise the authored-report
 * half — the list, the viewer, the editor, the period — which is the half that
 * belongs to this package outright, and a fixture that declared somebody's
 * `vendas-resumo` here would be putting a host's product back into the
 * package's own tests. The portability suite is where a full vocabulary is
 * declared, in a domain that shares no word with any host of ours.
 *
 * `timeZone` is stated rather than defaulted for the same reason the config
 * field is required: these tests assert on dates, and a zone nobody wrote down
 * is a zone nobody can check.
 */
export const TEST_SURFACE: ReportBuilderSurface = {
  systemReports: [],
  systemDashboards: [],
  sections: [],
  blockTemplates: [],
  timeZone: 'America/Sao_Paulo',
};
