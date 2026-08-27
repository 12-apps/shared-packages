/**
 * A top-level category with no children, driven through the panel.
 *
 * The tree model always called such a category a LEAF — `leavesOf` returns its
 * own id, `collectLeafIds` counts it, `Marcar tudo` ticks it and a chip appears
 * for it. Only the row and the activation disagreed: they read every top-level
 * row as a heading, so a childless category drew no control, expanded to
 * nothing, and could not be selected at all. On the estoque filter that is a
 * whole category the admin cannot filter by — while the very same category
 * arrives selected the moment `Marcar tudo` is pressed, which is what makes it
 * a disagreement rather than a policy.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PT_BR_CATEGORY_SELECT_COPY } from "../../../../pt-BR";
import { CategorySelect } from "../CategorySelect";
import type { CategorySelectOption } from "../CategorySelect.types";

/** One category with children, one without — the shape the screenshot showed. */
const OPTIONS: CategorySelectOption[] = [
  { id: "beb", name: "Bebidas" },
  { id: "beb.agua", name: "Águas", parentId: "beb" },
  { id: "combo", name: "Combos" },
];

function openMulti(onChange = vi.fn()): typeof onChange {
  render(
    <CategorySelect
      copy={PT_BR_CATEGORY_SELECT_COPY}
      mode="multi"
      options={OPTIONS}
      value={[]}
      onChange={onChange}
      dataTestId="cat"
    />,
  );
  fireEvent.click(screen.getByTestId("cat-trigger"));
  return onChange;
}

describe("a category with no children", () => {
  afterEach(cleanup);

  it("is selectable in the multi-select filter", () => {
    const onChange = openMulti();

    fireEvent.click(screen.getByTestId("cat-category-combo"));
    fireEvent.click(screen.getByTestId("cat-apply"));

    expect(onChange).toHaveBeenCalledWith(["combo"]);
  });

  it("says so in the DOM, so assistive tech can read the state", () => {
    openMulti();
    const row = screen.getByTestId("cat-category-combo");

    expect(row).toHaveAttribute("role", "option");
    expect(row).toHaveAttribute("aria-selected", "false");
    fireEvent.click(row);
    expect(screen.getByTestId("cat-category-combo")).toHaveAttribute("aria-selected", "true");
  });

  it("unticks on a second click, the way any leaf does", () => {
    const onChange = openMulti();

    fireEvent.click(screen.getByTestId("cat-category-combo"));
    fireEvent.click(screen.getByTestId("cat-category-combo"));
    fireEvent.click(screen.getByTestId("cat-apply"));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("draws no disclosure chevron — there is nothing under it to fold", () => {
    openMulti();

    // Asserted as the WHOLE set of chevrons rather than as the absence of one:
    // the category that has children keeps its, and the childless one never had
    // a chevron to lose.
    // Scoped to the list, so the panel's own "Expandir tudo" is not counted.
    const chevrons = within(screen.getByTestId("cat-list")).getAllByTestId(/^cat-expand-/);
    expect(chevrons.map((node) => node.dataset.testid)).toEqual(["cat-expand-beb"]);
  });

  it("is pickable in the single-select 'move to…' picker", () => {
    const onChange = vi.fn();
    render(
      <CategorySelect
        copy={PT_BR_CATEGORY_SELECT_COPY}
        mode="single"
        label="Categoria"
        options={OPTIONS}
        value={null}
        onChange={onChange}
        dataTestId="cat"
      />,
    );
    fireEvent.click(screen.getByTestId("cat-trigger"));

    fireEvent.click(screen.getByTestId("cat-category-combo"));

    expect(onChange).toHaveBeenCalledWith("combo");
  });

  it("keeps the parent WITH children a heading in single-select", () => {
    const onChange = vi.fn();
    render(
      <CategorySelect
        copy={PT_BR_CATEGORY_SELECT_COPY}
        mode="single"
        label="Categoria"
        options={OPTIONS}
        value={null}
        onChange={onChange}
        dataTestId="cat"
      />,
    );
    fireEvent.click(screen.getByTestId("cat-trigger"));

    // `Bebidas` has `Águas` under it, so it stays a heading and the subcategory
    // stays the thing you pick — this fix widens nothing for a category that has
    // children. Stated as the whole list of choosable rows, which says both
    // halves at once.
    const choosable = screen.getAllByRole("option");
    expect(choosable.map((node) => node.dataset.testid)).toEqual([
      "cat-option-beb.agua",
      "cat-category-combo",
    ]);

    fireEvent.click(screen.getByTestId("cat-option-beb.agua"));
    expect(onChange).toHaveBeenCalledWith("beb.agua");
  });

  it("is what `Marcar tudo` already selected, so the two now agree", () => {
    const onChange = openMulti();

    fireEvent.click(screen.getByTestId("cat-select-all"));
    fireEvent.click(screen.getByTestId("cat-apply"));

    expect(onChange).toHaveBeenCalledWith(["beb.agua", "combo"]);
  });
});
