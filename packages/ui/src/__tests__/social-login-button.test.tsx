import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles/index.js";
import { EN_US_SOCIAL_LOGIN_COPY } from "../en-US";
import { PT_BR_SOCIAL_LOGIN_COPY } from "../pt-BR";
import {
  SocialLoginButton,
  SocialLoginContainer,
  type SocialProvider,
} from "../social-login-button";

describe("SocialLoginButton", () => {
  const providers: SocialProvider[] = ["google", "facebook", "apple"];

  describe.each(providers)("%s provider", (provider) => {
    it(`should render ${provider} button with correct text`, () => {
      render(<SocialLoginButton provider={provider} copy={EN_US_SOCIAL_LOGIN_COPY} />);

      const expectedTexts: Record<SocialProvider, string> = {
        google: "Continue with Google",
        facebook: "Continue with Facebook",
        apple: "Continue with Apple",
      };

      expect(screen.getByText(expectedTexts[provider])).toBeInTheDocument();
    });

    it(`keeps rendering English for ${provider} when no pack is passed`, () => {
      // What makes this a MINOR rather than a major: an existing caller that
      // passes no copy is unchanged. Pinned so the default cannot be dropped
      // without a deliberate breaking release.
      render(<SocialLoginButton provider={provider} />);

      expect(
        screen.getByRole("button", { name: EN_US_SOCIAL_LOGIN_COPY[provider] }),
      ).toBeInTheDocument();
    });

    it(`renders the host's pack for ${provider}, not a baked-in English default`, () => {
      // The whole point of the required prop: this package ships both languages
      // and the host chooses. Before it existed a pt-BR storefront rendered
      // "Continue with Google" on an otherwise Portuguese sign-in screen, with
      // no way to reach the string.
      render(<SocialLoginButton provider={provider} copy={PT_BR_SOCIAL_LOGIN_COPY} />);

      // The ACCESSIBLE NAME, not just DOM text — this button exists to be read
      // aloud in the right language.
      expect(
        screen.getByRole("button", { name: PT_BR_SOCIAL_LOGIN_COPY[provider] }),
      ).toBeInTheDocument();
    });

    it(`should call onClick when ${provider} button is clicked`, () => {
      const handleClick = vi.fn();
      render(<SocialLoginButton provider={provider} copy={EN_US_SOCIAL_LOGIN_COPY} onClick={handleClick} />);

      const button = screen.getByRole("button");
      fireEvent.click(button);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it(`should show loading state for ${provider}`, () => {
      const { container } = render(<SocialLoginButton provider={provider} copy={EN_US_SOCIAL_LOGIN_COPY} loading />);

      // When loading, Button shows CircularProgress spinner
      expect(container.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
    });

    it(`should be disabled when loading for ${provider}`, () => {
      render(<SocialLoginButton provider={provider} copy={EN_US_SOCIAL_LOGIN_COPY} loading />);

      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
    });

    it(`should be disabled when disabled prop is true for ${provider}`, () => {
      render(<SocialLoginButton provider={provider} copy={EN_US_SOCIAL_LOGIN_COPY} disabled />);

      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
    });
  });

  it("should apply fullWidth style by default", () => {
    render(<SocialLoginButton provider="google" copy={EN_US_SOCIAL_LOGIN_COPY} />);

    const button = screen.getByRole("button");
    // MUI Button with fullWidth prop applies width: 100%
    expect(button).toHaveClass('MuiButton-fullWidth');
  });

  it("should not have fullWidth class when fullWidth is false", () => {
    render(<SocialLoginButton provider="google" copy={EN_US_SOCIAL_LOGIN_COPY} fullWidth={false} />);

    const button = screen.getByRole("button");
    expect(button).not.toHaveClass('MuiButton-fullWidth');
  });

  it("should not call onClick when disabled", () => {
    const handleClick = vi.fn();
    render(
      <SocialLoginButton provider="google" copy={EN_US_SOCIAL_LOGIN_COPY} onClick={handleClick} disabled />
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(handleClick).not.toHaveBeenCalled();
  });

  it("should render correct SVG icon for each provider", () => {
    const { container: googleContainer } = render(
      <SocialLoginButton provider="google" copy={EN_US_SOCIAL_LOGIN_COPY} />
    );
    expect(googleContainer.querySelector("svg")).toBeInTheDocument();

    const { container: facebookContainer } = render(
      <SocialLoginButton provider="facebook" copy={EN_US_SOCIAL_LOGIN_COPY} />
    );
    expect(facebookContainer.querySelector("svg")).toBeInTheDocument();

    const { container: appleContainer } = render(
      <SocialLoginButton provider="apple" copy={EN_US_SOCIAL_LOGIN_COPY} />
    );
    expect(appleContainer.querySelector("svg")).toBeInTheDocument();
  });
});

describe("SocialLoginButton with iconOnly (FUT-2393)", () => {
  const providers: SocialProvider[] = ["google", "facebook", "apple"];

  it.each(providers)("keeps %s's label as the accessible name and drops it from view", (provider) => {
    // The logo alone is for a narrow row of providers; a screen reader must
    // still hear which provider the button signs in with, in the host's words.
    render(<SocialLoginButton provider={provider} copy={PT_BR_SOCIAL_LOGIN_COPY} iconOnly />);

    const label = PT_BR_SOCIAL_LOGIN_COPY[provider];
    const button = screen.getByRole("button", { name: label });
    expect(button).not.toHaveTextContent(label);
    // Named by aria-label, not only by the title's fallback: a title is not
    // exposed on a touch screen, where this row is meant to be used.
    expect(button).toHaveAttribute("aria-label", label);
    expect(button).toHaveAttribute("title", label);
    expect(button.querySelector("svg")).toBeInTheDocument();
  });

  it("still writes the label beside the logo when iconOnly is not set", () => {
    render(<SocialLoginButton provider="google" copy={PT_BR_SOCIAL_LOGIN_COPY} />);

    const button = screen.getByRole("button", { name: PT_BR_SOCIAL_LOGIN_COPY.google });
    expect(button).toHaveTextContent(PT_BR_SOCIAL_LOGIN_COPY.google);
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).not.toHaveAttribute("title");
  });

  it("spins in place of the logo while its provider hands off, and keeps its name", () => {
    const { container } = render(
      <SocialLoginButton provider="google" copy={PT_BR_SOCIAL_LOGIN_COPY} iconOnly loading />,
    );

    expect(container.querySelector(".MuiCircularProgress-root")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PT_BR_SOCIAL_LOGIN_COPY.google })).toBeDisabled();
  });
});

describe("SocialLoginButton's logo, pressable or not (FUT-2393)", () => {
  const providers: SocialProvider[] = ["google", "facebook", "apple"];

  /** The slot MUI renders the logo in, beside or instead of the label. */
  const logoSlot = (socialButton: HTMLElement): HTMLElement => {
    const slot = socialButton.querySelector<HTMLElement>(".MuiButton-startIcon");
    if (!slot) throw new Error("the button rendered no logo slot");
    return slot;
  };

  /** Nothing from `root` down is faded or filtered, however it is spelled. */
  const expectUnfaded = (root: Element): void => {
    for (const drawn of [root, ...root.querySelectorAll("*")]) {
      expect(["", "1"]).toContain(getComputedStyle(drawn).opacity);
      expect(["", "none"]).toContain(getComputedStyle(drawn).filter);
    }
  };

  it.each([true, false])("draws Google's G in one faded grey on a disabled button (iconOnly: %s)", (iconOnly) => {
    // The G is drawn in Google's own colours, so MUI greying the label left a
    // full-colour G on a disabled button. With the logo alone there is no
    // label left to say the button cannot be pressed.
    render(<SocialLoginButton provider="google" copy={PT_BR_SOCIAL_LOGIN_COPY} iconOnly={iconOnly} disabled />);

    const logo = getComputedStyle(logoSlot(screen.getByRole("button")));
    expect(logo.filter).toBe("brightness(0)");
    expect(logo.opacity).toBe("0.38");
  });

  it("fades the G by the theme's disabledOpacity, not a copy of MUI's default", () => {
    render(
      <ThemeProvider theme={createTheme({ palette: { action: { disabledOpacity: 0.5 } } })}>
        <SocialLoginButton provider="google" copy={PT_BR_SOCIAL_LOGIN_COPY} iconOnly disabled />
      </ThemeProvider>,
    );

    expect(getComputedStyle(logoSlot(screen.getByRole("button"))).opacity).toBe("0.5");
  });

  it.each(["facebook", "apple"] as const)("lets %s's logo grey with its label rather than fading it twice", (provider) => {
    // Drawn in the button's own colour, this logo is already MUI's disabled
    // grey on a disabled button; fading it again would all but erase it.
    render(<SocialLoginButton provider={provider} copy={PT_BR_SOCIAL_LOGIN_COPY} iconOnly disabled />);

    expectUnfaded(logoSlot(screen.getByRole("button")));
  });

  it("draws Facebook's logo in the button's own colour, so it shows on the blue", () => {
    // The icon is a #1877F2 roundel with the f cut out of it, on a #1877F2
    // button: drawn in its own colour it vanished, and an icon-only button was
    // an empty blue slab.
    render(<SocialLoginButton provider="facebook" copy={PT_BR_SOCIAL_LOGIN_COPY} iconOnly />);

    const facebook = screen.getByRole("button", { name: PT_BR_SOCIAL_LOGIN_COPY.facebook });
    const roundel = logoSlot(facebook).querySelector("path");
    if (!roundel) throw new Error("the Facebook logo drew no path");
    expect(getComputedStyle(roundel).fill.toLowerCase()).toBe("currentcolor");
    expect(getComputedStyle(roundel).color).toBe(getComputedStyle(facebook).color);
    expect(getComputedStyle(roundel).color).not.toBe(getComputedStyle(facebook).backgroundColor);
  });

  it("draws Apple's logo in the button's own colour", () => {
    render(<SocialLoginButton provider="apple" copy={PT_BR_SOCIAL_LOGIN_COPY} iconOnly />);

    const apple = screen.getByRole("button", { name: PT_BR_SOCIAL_LOGIN_COPY.apple });
    expect(logoSlot(apple).querySelector("svg")).toHaveAttribute("fill", "currentColor");
  });

  it.each(providers)("keeps %s's logo unfaded while the button can be pressed", (provider) => {
    render(<SocialLoginButton provider={provider} copy={PT_BR_SOCIAL_LOGIN_COPY} iconOnly />);

    expectUnfaded(logoSlot(screen.getByRole("button")));
  });

  it("does not fade the spinner of a provider handing off", () => {
    // Loading disables the button too, but the spinner replaces the logo and
    // is the one sign that something is happening: nothing in the button is
    // faded further than MUI's disabled colour already draws it.
    render(<SocialLoginButton provider="google" copy={PT_BR_SOCIAL_LOGIN_COPY} iconOnly loading />);

    const handingOff = screen.getByRole("button", { name: PT_BR_SOCIAL_LOGIN_COPY.google });
    expect(within(handingOff).getByRole("progressbar")).toBeInTheDocument();
    expectUnfaded(handingOff);
  });
});

describe("SocialLoginContainer", () => {
  it("should render children", () => {
    render(
      <SocialLoginContainer>
        <span>Child content</span>
      </SocialLoginContainer>
    );

    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("should render default title", () => {
    render(
      <SocialLoginContainer>
        <span>Content</span>
      </SocialLoginContainer>
    );

    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
  });

  it("should render custom title", () => {
    render(
      <SocialLoginContainer title="Welcome Back">
        <span>Content</span>
      </SocialLoginContainer>
    );

    expect(screen.getByText("Welcome Back")).toBeInTheDocument();
  });

  it("should not render title when title is empty", async () => {
    render(
      <SocialLoginContainer title="">
        <span>Content</span>
      </SocialLoginContainer>
    );

    await waitFor(() => expect(screen.queryByRole("heading")).not.toBeInTheDocument());
  });

  it("should render divider when showDivider is true", () => {
    render(
      <SocialLoginContainer showDivider>
        <span>Content</span>
      </SocialLoginContainer>
    );

    expect(screen.getByText("or")).toBeInTheDocument();
  });

  it("should not render divider by default", async () => {
    render(
      <SocialLoginContainer>
        <span>Content</span>
      </SocialLoginContainer>
    );

    await waitFor(() => expect(screen.queryByText("or")).not.toBeInTheDocument());
  });

  it("should render custom divider text", () => {
    render(
      <SocialLoginContainer showDivider dividerText="or continue with email">
        <span>Content</span>
      </SocialLoginContainer>
    );

    expect(screen.getByText("or continue with email")).toBeInTheDocument();
  });

  it("should render multiple buttons", () => {
    render(
      <SocialLoginContainer>
        <SocialLoginButton provider="google" copy={EN_US_SOCIAL_LOGIN_COPY} />
        <SocialLoginButton provider="facebook" copy={EN_US_SOCIAL_LOGIN_COPY} />
        <SocialLoginButton provider="apple" copy={EN_US_SOCIAL_LOGIN_COPY} />
      </SocialLoginContainer>
    );

    expect(screen.getByText("Continue with Google")).toBeInTheDocument();
    expect(screen.getByText("Continue with Facebook")).toBeInTheDocument();
    expect(screen.getByText("Continue with Apple")).toBeInTheDocument();
  });
});
