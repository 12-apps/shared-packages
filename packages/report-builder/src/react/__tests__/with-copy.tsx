import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { JSX, ReactElement, ReactNode } from "react";

import { PT_BR_REPORT_ENGINE_COPY } from "../../pt-BR";
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from "../../server/pt-BR";
import { PT_BR_REPORT_SCREENS_COPY } from "../pt-BR";
import { httpTransport } from "../transport";
import { ReportBuilderProvider } from "../transport-context";

/**
 * Render a report screen with copy in scope.
 *
 * `useReportCopy` THROWS outside the provider — deliberately, because a screen
 * with no words is broken and a default would be the origin host's Portuguese.
 * That makes the provider part of what these component tests have to set up,
 * exactly as a real host does. Wrapping here rather than in each file keeps the
 * pack named once.
 */
function CopyWrapper({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ReportBuilderProvider
      transport={httpTransport()}
      tenantSlug="acme"
      surface={{
        systemReports: [],
        systemDashboards: [],
        sections: [],
        blockTemplates: [],
        timeZone: "UTC",
      }}
      copy={{
        engine: PT_BR_REPORT_ENGINE_COPY,
        blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
        screens: PT_BR_REPORT_SCREENS_COPY,
      }}
    >
      {children}
    </ReportBuilderProvider>
  );
}

export function renderWithCopy(ui: ReactElement, options?: RenderOptions): RenderResult {
  return render(ui, { wrapper: CopyWrapper, ...options });
}
