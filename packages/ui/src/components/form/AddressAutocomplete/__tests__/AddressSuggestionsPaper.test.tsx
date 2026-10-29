import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AddressSuggestionsPaper } from "../AddressSuggestionsPaper";

// MUI never renders `noOptionsText` for a freeSolo field, so the paper says the
// empty text itself, and only when MUI gave it nothing to show (FUT-4162).
describe("AddressSuggestionsPaper", () => {
  it("says the empty text when it has no content", () => {
    render(<AddressSuggestionsPaper emptyText="Nenhum endereço encontrado" />);
    expect(screen.getByTestId("address-suggestions-empty")).toHaveTextContent("Nenhum endereço encontrado");
  });

  it("stays quiet over suggestions or a loading row", () => {
    render(
      <AddressSuggestionsPaper emptyText="Nenhum endereço encontrado">
        <ul>
          <li>Rua A</li>
        </ul>
      </AddressSuggestionsPaper>,
    );
    // Rendered synchronously: the paper holds the suggestion and nothing else.
    expect(screen.getByTestId("address-suggestions-dropdown")).toHaveTextContent(/^Rua A$/);
  });

  it("says nothing without an empty text, as after a failed lookup", () => {
    render(<AddressSuggestionsPaper />);
    expect(screen.getByTestId("address-suggestions-dropdown")).toBeEmptyDOMElement();
  });
});
