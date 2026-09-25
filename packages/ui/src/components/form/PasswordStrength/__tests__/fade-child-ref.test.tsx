/**
 * The requirement and suggestion lists fade in, and a fade needs a DOM node.
 *
 * MUI's `Fade` clones its child with a `ref` and, on enter, reads `scrollTop`
 * off that node to force a reflow. Both lists were plain function components
 * that dropped the ref, so the node was `null` and the enter threw — on the
 * first render with a value, and the moment a shopper typed the first
 * character into an empty field. Every Storybook story that showed a password
 * rendered Storybook's error page instead of the component.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PT_BR_PASSWORD_STRENGTH_COPY } from "../../../../pt-BR";
import { PasswordStrength } from "../PasswordStrength";

afterEach(cleanup);

describe("PasswordStrength — the faded lists hand Fade a node", () => {
  it("renders the requirements for a typed password without throwing", () => {
    render(<PasswordStrength copy={PT_BR_PASSWORD_STRENGTH_COPY} value="abc" showRequirements />);

    expect(screen.getByText(PT_BR_PASSWORD_STRENGTH_COPY.requirementsHeading)).toBeInTheDocument();
  });

  it("survives the first character typed into an empty field", () => {
    const { rerender } = render(
      <PasswordStrength copy={PT_BR_PASSWORD_STRENGTH_COPY} value="" showRequirements />,
    );

    rerender(<PasswordStrength copy={PT_BR_PASSWORD_STRENGTH_COPY} value="a" showRequirements />);

    expect(screen.getByText(PT_BR_PASSWORD_STRENGTH_COPY.requirementsHeading)).toBeInTheDocument();
  });

  it("renders the suggestions for a weak password without throwing", () => {
    render(
      <PasswordStrength
        copy={PT_BR_PASSWORD_STRENGTH_COPY}
        value="abc"
        showRequirements={false}
        showSuggestions
      />,
    );

    expect(screen.getByText(PT_BR_PASSWORD_STRENGTH_COPY.suggestionsHeading)).toBeInTheDocument();
  });
});
