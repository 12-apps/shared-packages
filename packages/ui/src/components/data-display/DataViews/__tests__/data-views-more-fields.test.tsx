/**
 * A FIELD KEEPS ITS CONTROL WHEN IT MOVES INTO "MAIS".
 *
 * On a phone most filters live in the overflow panel, and the panel used to
 * build its own flat dropdown for every one of them. So a field's config held
 * only while it fitted on the bar: `control: "category"` lost its tree — the
 * subcategories flattened into one list next to their parents — and
 * `searchEnabled` lost its search. These pin the panel to the bar's control.
 */
import { fireEvent, render, screen } from "./test-utils";
import { describe, expect, it, vi } from "vitest";

import { MoreGroup } from "../data-views-more-fields";
import { toOverflowFields } from "../data-views-overflow";
import type { FilterFieldConfig, FilterOption } from "../data-views-types";

type Row = Record<string, unknown>;

const tree = (): FilterOption[] => [
  { value: "beb", label: "Bebidas" },
  { value: "beb.alc", label: "Com álcool", parentId: "beb" },
  { value: "beb.sem", label: "Sem álcool", parentId: "beb" },
  { value: "balcao", label: "Balcão do evento" },
];

const letters = (count: number): FilterOption[] =>
  Array.from({ length: count }, (_, index) => ({ value: `o${index}`, label: `Opção ${index}` }));

function renderGroup(pill: FilterFieldConfig<Row>, selected: string[] = []): ReturnType<typeof vi.fn> {
  const onTogglePill = vi.fn();
  const [field] = toOverflowFields<Row>([pill], []);
  if (!field) throw new Error("no overflow field");
  render(
    <MoreGroup
      field={field}
      pills={{ [pill.id]: selected }}
      ranges={{}}
      onTogglePill={onTogglePill}
      onChangeRange={() => undefined}
      testIdPrefix="t"
    />,
  );
  return onTogglePill;
}

describe("a category field in the overflow", () => {
  it("renders the category TREE, not the flat multi-select", () => {
    renderGroup({ id: "categoria", label: "Categoria", control: "category", options: tree() });

    fireEvent.click(screen.getByTestId("t-more-categoria-trigger"));

    // The tree's own furniture: parent row, child row, quick actions, footer.
    expect(screen.getByTestId("t-more-categoria-category-beb")).toBeInTheDocument();
    expect(screen.getByTestId("t-more-categoria-option-beb.alc")).toBeInTheDocument();
    expect(screen.getByTestId("t-more-categoria-select-all")).toBeInTheDocument();
    expect(screen.getByTestId("t-more-categoria-expand-all")).toBeInTheDocument();
    expect(screen.getByTestId("t-more-categoria-footer")).toBeInTheDocument();
  });

  it("stays a tree with two options, where a plain field would go flat", () => {
    renderGroup({ id: "categoria", label: "Categoria", control: "category", options: tree().slice(0, 2) });

    // A flat row would have painted its checkboxes already; the tree is a
    // closed trigger until tapped.
    expect(screen.getByTestId("t-more-categoria-trigger")).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("writes a picked subcategory through the pill channel", () => {
    const onTogglePill = renderGroup({ id: "categoria", label: "Categoria", control: "category", options: tree() });

    fireEvent.click(screen.getByTestId("t-more-categoria-trigger"));
    fireEvent.click(screen.getByTestId("t-more-categoria-option-beb.alc"));
    fireEvent.click(screen.getByTestId("t-more-categoria-apply"));

    expect(onTogglePill).toHaveBeenCalledWith("categoria", "beb.alc", true);
  });

  it("honours allowParentSelection, as the bar does", () => {
    const onTogglePill = renderGroup({
      id: "categoria",
      label: "Categoria",
      control: "category",
      allowParentSelection: true,
      options: tree(),
    });

    fireEvent.click(screen.getByTestId("t-more-categoria-trigger"));
    fireEvent.click(screen.getByTestId("t-more-categoria-category-beb"));
    fireEvent.click(screen.getByTestId("t-more-categoria-apply"));

    expect(onTogglePill).toHaveBeenCalledWith("categoria", "beb.alc", true);
    expect(onTogglePill).toHaveBeenCalledWith("categoria", "beb.sem", true);
  });
});

describe("search in the overflow follows the bar's rule", () => {
  it("keeps a searchEnabled field searchable however few options it has", () => {
    renderGroup({ id: "papel", label: "Papel", searchEnabled: true, options: letters(2) });

    fireEvent.click(screen.getByTestId("t-more-papel"));

    expect(screen.getByTestId("t-more-papel-search")).toBeInTheDocument();
  });

  it("does not add a search the bar would not show (7 options)", () => {
    renderGroup({ id: "cliente", label: "Cliente", options: letters(7) });

    fireEvent.click(screen.getByTestId("t-more-cliente"));

    expect(screen.getByText("Opção 0")).toBeInTheDocument();
    expect(screen.queryAllByTestId("t-more-cliente-search")).toHaveLength(0);
  });

  it("shows the search once the list is long enough for the bar to (9 options)", () => {
    renderGroup({ id: "cliente", label: "Cliente", options: letters(9) });

    fireEvent.click(screen.getByTestId("t-more-cliente"));

    expect(screen.getByTestId("t-more-cliente-search")).toBeInTheDocument();
  });
});

describe("a field that asked for a dropdown", () => {
  it("stays a dropdown with two options, as in the filter panel", () => {
    renderGroup({ id: "turno", label: "Turno", control: "multiselect", options: letters(2) });

    expect(screen.getByTestId("t-more-turno")).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });
});

describe("a plain two-option field", () => {
  it("stays a flat row of checkboxes — a panel layout, not a different control", () => {
    const onTogglePill = renderGroup({ id: "status", label: "Status", options: letters(2) });

    const option = screen.getByTestId("t-more-status-o1").querySelector("input");
    if (!option) throw new Error("no checkbox");
    fireEvent.click(option);

    expect(onTogglePill).toHaveBeenCalledWith("status", "o1", true);
  });
});
