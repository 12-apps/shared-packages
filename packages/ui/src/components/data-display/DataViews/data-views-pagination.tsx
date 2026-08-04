"use client";

import { Box } from "../../../mui/Box";
import { Pagination } from "../../navigation/Pagination";

import type { DataViewsController } from "./use-data-views-state";

/**
 * The server-mode pagination control rendered beneath the grid — shown only
 * when the table is backend-driven and there is more than one page. Client-mode
 * tables render every matched row at once, so they never show it (FUT-180).
 */
export function DataViewsPagination<T extends Record<string, unknown>>({
  c,
  testIdPrefix,
}: {
  c: DataViewsController<T>;
  testIdPrefix: string;
}): React.JSX.Element | null {
  if (!c.serverMode || c.serverPageCount <= 1) return null;
  return (
    <Box sx={{ mt: 2, display: "flex", justifyContent: "center" }}>
      <Pagination
        page={c.serverPage}
        count={c.serverPageCount}
        onChange={(_event, page) => c.changePage(page)}
        dataTestId={`${testIdPrefix}-pagination`}
      />
    </Box>
  );
}
