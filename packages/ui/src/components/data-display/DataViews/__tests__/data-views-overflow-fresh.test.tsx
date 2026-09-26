/**
 * THE SPLIT IS CACHED BY ID, THE FIELDS ARE NOT.
 *
 * `useFilterOverflow` caches which ids sit on the bar and which in "Mais",
 * keyed on the ids — so a field whose options arrive late (a category list
 * still loading) does not re-split. It used to hand back the cached field
 * objects too, which served the EMPTY option list for good: "Categoria" in
 * "Mais" rendered a label with nothing under it (FUT-2828).
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { toOverflowFields, useFilterOverflow } from "../data-views-overflow";
import type { FilterFieldConfig } from "../data-views-types";

type Row = Record<string, unknown>;

const categoria = (count: number): FilterFieldConfig<Row> => ({
  id: "categoria",
  label: "Categoria",
  control: "category",
  options: Array.from({ length: count }, (_, index) => ({ value: `c${index}`, label: `Categoria ${index}` })),
});

describe("useFilterOverflow", () => {
  it("serves a field's CURRENT options after they load, with the split unchanged", () => {
    const { result, rerender } = renderHook(
      ({ count, frozen }: { count: number; frozen: boolean }) =>
        useFilterOverflow<Row>(toOverflowFields([categoria(count)], []), {}, {}, frozen),
      { initialProps: { count: 0, frozen: false } },
    );
    const placed = (): FilterFieldConfig<Row>[] =>
      [...result.current.inline, ...result.current.overflow].flatMap((field) => (field.pill ? [field.pill] : []));
    expect(placed()[0]?.options).toHaveLength(0);

    rerender({ count: 5, frozen: false });
    expect(placed()[0]?.options).toHaveLength(5);

    // Frozen (a popover open) holds the ARRANGEMENT, not the option list.
    rerender({ count: 8, frozen: true });
    expect(placed()[0]?.options).toHaveLength(8);
  });
});
