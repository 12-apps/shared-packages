import type { CSSProperties, ComponentType, JSX, ReactNode } from "react";

import { Card, CardContent } from "@12-apps/ui/layout/Card";
import { Container } from "@12-apps/ui/layout/Container";
import { Separator } from "@12-apps/ui/layout/Separator";
import { Heading } from "@12-apps/ui/typography/Heading";
import { Text } from "@12-apps/ui/typography/Text";

/**
 * The auth card — the shell both whole pages render inside.
 *
 * ## Why the rhythm is a `gap` and not a stack of spacers
 *
 * This layout used to be a `Stack` of fragments with a `<Spacer>` inside each
 * one, and the two spacing systems ADDED UP. MUI's `Stack` puts its own margin
 * on every DOM sibling, so a `Spacer size="lg"` between two blocks contributed
 * its own 24px *and* collected 16px of stack margin on both sides — 56px where
 * the code said 24. Measured on the storefront's sign-in screen at 375×667:
 *
 *   | between                          | intended | rendered |
 *   |----------------------------------|----------|----------|
 *   | the form and "ou entre com"      |     24px |     56px |
 *   | "ou entre com" and the buttons   |      8px |     40px |
 *   | the buttons and the footer       |     24px |     57px |
 *
 * That is 105px of space nobody wrote, on a card that was 590px tall — and it
 * is why the Google button sat below the fold on a phone.
 *
 * One flex column with one `gap` cannot drift that way: the gap is the ONLY
 * thing between two blocks, it applies once, and a block that renders nothing
 * (an absent notice, a hidden form) leaves no gap behind it. Each child below
 * is therefore ONE element rather than a fragment of element-plus-spacer.
 *
 * ## Why the layout lives here rather than in `@12-apps/ui`
 *
 * `SocialLoginContainer` is a card for a ROW OF PROVIDER BUTTONS, and it is
 * still the right component for one. An auth page is a different thing — a
 * heading, a form, a divider that separates two ways in, and a footer — and its
 * vertical rhythm is the whole design. Composing it here from `Card`,
 * `Separator`, `Heading` and `Text` keeps that rhythm visible and leaves the
 * design system's own components untouched.
 */

/** Router-agnostic link. A host passes its own — `react-router`'s, or an `<a>`. */
export type AuthLink = ComponentType<{
  to: string;
  children: ReactNode;
  "data-testid"?: string;
  style?: Record<string, string | number>;
}>;

const COLUMN: CSSProperties = { display: "flex", flexDirection: "column" };

/** The space between two blocks of the card, and between the two rules of one. */
const BLOCK_GAP = "1.25rem";
const TITLE_GAP = "0.25rem";
const PROVIDER_GAP = "0.875rem";

/**
 * The divider's test hook.
 *
 * A test asking "is the divider there?" used to look for its WORDS in the
 * card's `textContent`, which was safe only while the words were long. They are
 * "ou" now — two letters that any other sentence on the page may legitimately
 * contain — so the question is asked of the element instead.
 */
export const PROVIDER_DIVIDER_TEST_ID = "auth-provider-divider";

/**
 * Fill the space the HOST's shell gives us instead of restating the viewport.
 *
 * `Container variant="centered"` carries a viewport-height floor, which is
 * right for a page that owns the whole window and wrong for one mounted inside
 * an app shell: the floor is then added UNDERNEATH the shell's header and above
 * its footer, so the document is taller than the window no matter how small the
 * card is. The storefront measured 829px of document in a 667px window with a
 * card that fitted in it twice over — a scrollbar produced entirely by this.
 *
 * Dropping the floor and GROWING into the content area instead measured 668px
 * of document in a 667px window on the same screen, and 800 in 800 on a
 * desktop. Both halves are load-bearing: without `minHeight` the container
 * keeps the viewport floor and nothing changes, and without `flexGrow` it is
 * only as tall as the card — which is fine on a phone, where the content area
 * is the card, and leaves the card sitting 130px above centre on a desktop,
 * where it is not.
 *
 * A host with no shell around the page has nothing for the container to grow
 * into, and gets a card at the top of the window: no floor rather than one that
 * overflows.
 */
const FILL_HOST_SHELL = { flexGrow: 1, minHeight: "auto" } as const;

interface AuthCardProps {
  title: string;
  /** A line under the title. Optional: not every product wants one. */
  subtitle?: string;
  /** The host's logo or store name, rendered above the card and untouched. */
  branding?: ReactNode;
  /** How wide the card may get. */
  maxWidth: number;
  children: ReactNode;
}

export function AuthCard({
  title,
  subtitle,
  branding,
  maxWidth,
  children,
}: AuthCardProps): JSX.Element {
  return (
    <Container variant="centered" padding="lg" sx={FILL_HOST_SHELL}>
      {branding}
      <Card variant="elevated" borderRadius="lg" sx={{ width: "100%", maxWidth }}>
        <CardContent>
          <div style={{ ...COLUMN, gap: BLOCK_GAP }}>
            <div style={{ ...COLUMN, gap: TITLE_GAP, textAlign: "center" }}>
              <Heading level="h2">{title}</Heading>
              {subtitle !== undefined && (
                <Text color="secondary" size="sm">
                  {subtitle}
                </Text>
              )}
            </div>
            {children}
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}

/**
 * The providers, and the divider under them, identical on both pages.
 *
 * ## The providers come FIRST, above the e-mail form
 *
 * They used to sit under it (FUT-873), on the argument that a returning
 * password user should not have to scroll past three large buttons to reach the
 * thing they came for. The scrolling was real; the diagnosis was not. The card
 * was 590px tall because 105px of it was spacing nobody wrote (see {@link
 * AuthCard}), and reordering the two methods only moved which one fell off the
 * bottom of a phone. With the spacing fixed the whole card fits, so the order
 * is free to be decided on its merits — and one tap beats an address, a
 * password and a keyboard for most people signing in.
 *
 * ## Why the divider is under them rather than over
 *
 * `label` is what the divider SAYS, and it only means anything when there is
 * something on BOTH sides of it. With the platform's e-mail method switched off
 * the form is not rendered, and a rule at the bottom of the card would then
 * fence off nothing — the screen reads as though a form failed to load rather
 * than as a Google-only sign-in.
 *
 * So the label is OPTIONAL, and the caller passes it only when it has rendered
 * something below. Omitted, the buttons still render — they are the whole
 * method now, not the alternative to one.
 *
 * It is drawn as a RULE with the words inside it, not as a line of grey text
 * floating over the gap. The words are a boundary between two ways in, and a
 * boundary that draws no line reads as a caption for whatever happens to be
 * nearest — which, with the spacing this card used to have, was nothing.
 */
export function ProviderBlock({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}): JSX.Element | null {
  if (!children) return null;
  return (
    <div style={{ ...COLUMN, gap: PROVIDER_GAP }}>
      {children}
      {label !== undefined && (
        <Separator size="xs" margin={0} data-testid={PROVIDER_DIVIDER_TEST_ID}>
          {label}
        </Separator>
      )}
    </div>
  );
}

/** The footer sentence with a link to the other page. */
export function AuthFooter({
  prompt,
  linkText,
  to,
  Link,
  dataTestId,
}: {
  prompt: string;
  linkText: string;
  to: string;
  Link: AuthLink;
  dataTestId: string;
}): JSX.Element {
  return (
    <Text color="secondary" size="sm" style={{ textAlign: "center" }}>
      {prompt}{" "}
      <Link to={to} data-testid={dataTestId} style={{ fontWeight: 600 }}>
        {linkText}
      </Link>
    </Text>
  );
}
