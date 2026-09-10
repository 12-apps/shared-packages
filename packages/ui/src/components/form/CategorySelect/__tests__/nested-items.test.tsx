/**
 * A third storey: items filed under a subcategory, driven through the panel.
 *
 * The tree stopped at two levels. `buildCategoryGroups` grouped roots and their
 * direct children and promoted everything else to top level as an orphan, so a
 * payload of products filed under subcategories rendered as one flat list of
 * products sitting NEXT TO the categories — the list a picker adopts this
 * component to escape. These describe the level below the subcategories: it
 * nests, it folds, it searches, and only the item at the bottom is pickable.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PT_BR_CATEGORY_SELECT_COPY } from "../../../../pt-BR";
import { CategorySelect } from "../CategorySelect";
import type { CategorySelectOption } from "../CategorySelect.types";

/** Two categories deep, plus the trailing group for what is filed nowhere. */
const OPTIONS: CategorySelectOption[] = [
  { id: "beb", name: "Bebidas" },
  { id: "beb.refri", name: "Refrigerantes", parentId: "beb" },
  { id: "p.coca", name: "Coca-Cola", parentId: "beb.refri" },
  { id: "p.guarana", name: "Guaraná", parentId: "beb.refri" },
  { id: "merc", name: "Mercearia" },
  { id: "merc.graos", name: "Grãos", parentId: "merc" },
  { id: "p.arroz", name: "Arroz Agulhinha", parentId: "merc.graos" },
  { id: "sem", name: "Sem categoria" },
  { id: "p.gelo", name: "Gelo", parentId: "sem" },
];

function openPicker(value: string | null = null): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(
    <CategorySelect
      copy={PT_BR_CATEGORY_SELECT_COPY}
      mode="single"
      label="Componente"
      options={OPTIONS}
      value={value}
      onChange={onChange}
      dataTestId="pick"
    />,
  );
  fireEvent.click(screen.getByTestId("pick-trigger"));
  return onChange;
}

/** Every row currently drawn, in order, by the test id it answers to. */
function visibleRows(): (string | undefined)[] {
  return within(screen.getByTestId("pick-list"))
    .getAllByTestId(/^pick-(category|option)-/)
    .map((node) => node.dataset.testid);
}

describe("items nested under a subcategory", () => {
  afterEach(cleanup);

  it("opens onto the categories and subcategories, with the items folded away", () => {
    openPicker();

    // The point of the third level: opening does NOT dump every item on screen.
    expect(visibleRows()).toEqual([
      "pick-category-beb",
      "pick-option-beb.refri",
      "pick-category-merc",
      "pick-option-merc.graos",
      "pick-category-sem",
      "pick-option-p.gelo",
    ]);
  });

  it("reveals the items when the subcategory is unfolded", () => {
    openPicker();

    fireEvent.click(screen.getByTestId("pick-expand-beb.refri"));

    expect(visibleRows()).toEqual([
      "pick-category-beb",
      "pick-option-beb.refri",
      "pick-option-p.coca",
      "pick-option-p.guarana",
      "pick-category-merc",
      "pick-option-merc.graos",
      "pick-category-sem",
      "pick-option-p.gelo",
    ]);
  });

  it("picks the item and nothing above it", () => {
    const onChange = openPicker();

    // The frames carry no control, so the pickable set is the items alone —
    // stated as the whole list, which says both halves at once.
    const choosable = screen.getAllByRole("option");
    expect(choosable.map((node) => node.dataset.testid)).toEqual(["pick-option-p.gelo"]);

    fireEvent.click(screen.getByTestId("pick-expand-beb.refri"));
    fireEvent.click(screen.getByTestId("pick-option-p.coca"));

    expect(onChange).toHaveBeenCalledWith("p.coca");
  });

  it("folds the whole category away, subcategories and items with it", () => {
    openPicker();

    fireEvent.click(screen.getByTestId("pick-expand-beb"));

    expect(visibleRows()).toEqual([
      "pick-category-beb",
      "pick-category-merc",
      "pick-option-merc.graos",
      "pick-category-sem",
      "pick-option-p.gelo",
    ]);
  });

  it("keeps a searched item under both of its parents", () => {
    openPicker();

    fireEvent.change(screen.getByTestId("pick-search"), { target: { value: "guarana" } });

    expect(visibleRows()).toEqual([
      "pick-category-beb",
      "pick-option-beb.refri",
      "pick-option-p.guarana",
    ]);
  });

  it("reads the whole path back on the closed trigger", () => {
    openPicker("p.arroz");

    expect(screen.getByTestId("pick-trigger")).toHaveTextContent(
      "Mercearia › Grãos › Arroz Agulhinha",
    );
  });

  it("keeps the uncategorised group where the caller put it — last", () => {
    openPicker();

    const tops = visibleRows().filter((id) => id?.startsWith("pick-category-"));
    expect(tops.at(-1)).toBe("pick-category-sem");
  });
});
