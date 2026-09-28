// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { labelsOf } from "../../core/compose";
import { DEMO_CATALOG } from "../../__tests__/demo-catalog";

import { createRbacLabels } from "../labels";
import { PT_BR_RBAC_WEB_COPY } from "../pt-BR";
import {
  teamColumns,
  teamExportColumns,
  type TeamRow,
} from "../team-grid-config";

/**
 * A member holding a base role plus a SECOND system role and a tenant custom
 * role — the shape that hid the bug: only the base chip went through
 * `labels.roleLabel`, so a person's additional SEEDED role (not their custom
 * one) rendered by its raw catalog key (`CLERK`) instead of its translated
 * word (`Atendente de balcão`) everywhere the roster names a role beyond the
 * base — the cell, its underlying text/export value, and the CSV export.
 */
const ROW: TeamRow = {
  userId: "u1",
  role: "HEAD_LIBRARIAN",
  email: "a@b.c",
  name: "Ana",
  customRoles: ["CLERK", "Voluntário"],
  roles: ["HEAD_LIBRARIAN", "CLERK", "Voluntário"],
  status: "ENABLED",
  inviteId: null,
};

const labels = createRbacLabels(labelsOf(DEMO_CATALOG));
const copy = PT_BR_RBAC_WEB_COPY.teamTable;

function rolesColumnOf(labelsArg = labels) {
  const found = teamColumns(labelsArg, copy).find(
    (c) => c.id === "customRoles",
  );
  if (!found) throw new Error("customRoles column not found");
  return found;
}

describe("teamColumns roles cell", () => {
  it("translates every additional SEEDED role, not just the base one", async () => {
    const column = rolesColumnOf();
    render(
      <>
        {column.cell?.({
          value: undefined,
          row: ROW,
          rowIndex: 0,
          col: column,
        })}
      </>,
    );
    expect(screen.getByText("Bibliotecário-chefe")).toBeDefined();
    expect(screen.getByText("Atendente de balcão")).toBeDefined();
    // A tenant CUSTOM role has no catalog word and keeps its own name.
    expect(screen.getByText("Voluntário")).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText("CLERK")).toBeNull();
    });
  });

  it("translates the same roles in the column's own text accessor", () => {
    const column = rolesColumnOf();
    const value =
      typeof column.accessor === "function" ? column.accessor(ROW) : null;
    expect(value).toBe("Bibliotecário-chefe, Atendente de balcão, Voluntário");
  });
});

describe("teamExportColumns", () => {
  it("translates every additional SEEDED role in the customRoles export column", () => {
    const column = teamExportColumns(labels, copy).find(
      (c) => c.header === copy.exportHeaders.customRoles,
    );
    if (!column) throw new Error("customRoles export column not found");
    expect(column.value(ROW)).toBe("Atendente de balcão, Voluntário");
  });
});
