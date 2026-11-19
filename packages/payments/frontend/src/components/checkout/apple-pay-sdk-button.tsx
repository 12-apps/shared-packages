import { Box, type SxProps, type Theme } from "@mui/material";
import { useEffect, useRef, type JSX } from "react";

/**
 * Apple's own `<apple-pay-button>` element (FUT-5372), as Apple's SDK defines
 * it in a browser that is not Safari — Apple's Human Interface Guidelines ask
 * for Apple's button, never a look-alike, and Safari's `-apple-pay-button`
 * appearance does not exist there. Black, "pay", in the page's language.
 *
 * The element is made in an effect (the Google Pay mount's shape): React
 * never renders an element type the package's JSX does not know, and the
 * press opens the session synchronously, inside the tap, through `onPress`.
 * Held, the element is marked disabled, described by the reason, and a press
 * does nothing.
 */
export function ApplePaySdkButton({ label, onPress, testId, held = null, sx }: {
  /** The accessible name — the element's own text is Apple's. */
  label: string;
  onPress: () => void;
  testId: string;
  /** The id of the element saying why the button cannot act yet, or `null`. */
  held?: string | null;
  sx?: SxProps<Theme>;
}): JSX.Element {
  const mount = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ onPress, held });
  latest.current = { onPress, held };
  useEffect(() => {
    const element = mount.current;
    if (!element) return undefined;
    const button = document.createElement("apple-pay-button");
    button.setAttribute("buttonstyle", "black");
    button.setAttribute("type", "pay");
    button.setAttribute("locale", document.documentElement.lang || "pt-BR");
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    const press = (): void => {
      if (latest.current.held === null) latest.current.onPress();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      press();
    };
    button.addEventListener("click", press);
    button.addEventListener("keydown", key);
    element.replaceChildren(button);
    return () => element.replaceChildren();
  }, []);
  useEffect(() => {
    const button = mount.current?.firstElementChild;
    if (!button) return;
    button.setAttribute("aria-label", label);
    if (held) {
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-describedby", held);
    } else {
      button.removeAttribute("aria-disabled");
      button.removeAttribute("aria-describedby");
    }
  });
  return (
    <Box
      ref={mount}
      data-testid={testId}
      data-held={held ? "true" : undefined}
      sx={[
        {
          pointerEvents: held ? "none" : undefined,
          "& > apple-pay-button": {
            display: "block",
            "--apple-pay-button-width": "100%",
            "--apple-pay-button-height": "100%",
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
