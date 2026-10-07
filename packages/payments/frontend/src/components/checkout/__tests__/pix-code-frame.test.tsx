// @vitest-environment jsdom
/**
 * The code box is the Pix code's only frame (FUT-3368). A host whose `code`
 * text draws an inline-code chip — a tint, a border, padding — must not get a
 * box inside the box once the full code wraps: on the storefront the chip
 * turned the whole wrapped payload into a pink block inside the grey one.
 */
import { Box } from "@mui/material";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSX } from "react";

import { cleanup, render, screen } from "./test-utils";
import { PixPane } from "../pix-pane";
import { defaultCheckoutComponents } from "../mui-defaults";
import { CheckoutComponentsProvider, type CheckoutTextProps } from "../ui";

afterEach(cleanup);

/** The host's Text: the default one, except `code`, which wears a chip. */
function ChipCodeText(props: CheckoutTextProps): JSX.Element {
  const { Text } = defaultCheckoutComponents;
  if (props.variant !== "code") return <Text {...props} />;
  return (
    <Box
      component="p"
      data-testid={props["data-testid"]}
      sx={{ bgcolor: "rgb(255, 0, 0)", border: "1px solid rgb(255, 0, 0)", px: "6px", py: "2px" }}
    >
      {props.children}
    </Box>
  );
}

describe("the Pix code box", () => {
  it("undoes the host's inline-code chip inside the frame", () => {
    render(
      <CheckoutComponentsProvider components={{ Text: ChipCodeText }}>
        <PixPane
          pix={{ copyPaste: "00020126BR.GOV.BCB.PIX-frame", expiresAt: new Date(0).toISOString() }}
          tab="copy"
          onTab={vi.fn()}
          onCopy={vi.fn()}
        />
      </CheckoutComponentsProvider>,
    );

    // jsdom cascades by source order, not specificity, so the computed style
    // cannot show the override winning (a browser does: the storefront run
    // gate measures it). What this pins is the rule itself: the code's own
    // frame clears the child's chip, aimed at exactly that child.
    const frame = screen.getByTestId("pix-code").parentElement as HTMLElement;
    const frameClass = [...frame.classList].find((name) => name.startsWith("css-"));
    const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]) as CSSStyleRule[];
    const reset = rules.find((rule) => rule.selectorText?.includes(`.${frameClass}.${frameClass}>*`));

    const declared = (property: string): string | undefined => reset?.style.getPropertyValue(property);
    expect(declared("background-color")).toBe("transparent");
    expect(declared("padding")).toBe("0px");
    expect(declared("border-top-width") || declared("border")).toMatch(/^0(px)?( solid)?$/);
  });
});
