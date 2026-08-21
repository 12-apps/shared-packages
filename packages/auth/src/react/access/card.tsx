import type { JSX, ReactNode } from "react";

import { Avatar } from "@12-apps/ui/data-display/Avatar";
import { Card } from "@12-apps/ui/layout/Card";
import { Container } from "@12-apps/ui/layout/Container";
import { Heading } from "@12-apps/ui/typography/Heading";
import { Paragraph } from "@12-apps/ui/typography/Paragraph";

/**
 * The access card — the shell every screen in this surface sits in.
 *
 * ## Responsive by ARRANGEMENT, not by shrinking
 *
 * Three layouts, and they are genuinely different pages rather than one page at
 * three sizes:
 *
 * | width | arrangement |
 * |---|---|
 * | `< 480` | edge to edge, the action stuck to the bottom |
 * | `480–1023` | a centred card |
 * | `>= 1024` | two columns — the store on the left, the form on the right |
 *
 * A card that merely narrows ends up with its submit button below the fold on a
 * phone, which on a sign-in screen means somebody types a password and cannot
 * find the way to send it. Sticking the action to the bottom edge is why the
 * small layout is its own arrangement.
 *
 * The breakpoints are NUMBERS rather than a theme token: 1024 is the structural
 * switch between one column and two, which is a property of this layout, not of
 * whatever spacing scale a host's theme happens to use.
 *
 * ## Why the branding is a slot with data, not a node
 *
 * "Ninguém digita senha sem saber onde está" — nobody types a password without
 * knowing where they are. The card therefore always shows WHOSE it is, and the
 * host cannot simply forget to pass it. But which brand is shown is a host
 * decision that depends on the store's plan, so the host passes the DATA (name,
 * initials, colour) and this renders it the same way on every screen.
 *
 * A host on a plan without own-branding passes `platformName` instead, and the
 * store's name drops to the subtitle — still answering "where am I", without
 * implying a brand the store has not paid for.
 */

/** Which brand the card wears. Resolved by the host from the store's plan. */
export interface AccessBrand {
  /** The name shown large — the store's, or the platform's. */
  name: string;
  /** Two or three letters for the badge. */
  initials?: string;
  /** The store's colour, when it has earned one. */
  color?: string;
  /**
   * Shown small under the name.
   *
   * The store's own name on plans where the CARD is the platform's — so a
   * shopper still knows which shop they are signing in to.
   */
  subtitle?: string;
  /** A logo, when the store has one. Replaces the initials badge. */
  logoUrl?: string;
}

export interface AccessCardProps {
  brand: AccessBrand;
  /** The screen's own title — "Entrar", "Criar conta". */
  title: string;
  /** A line under the title. */
  subtitle?: string;
  /**
   * The action row, stuck to the bottom edge below 480px.
   *
   * Passed separately from `children` precisely so the small arrangement can
   * move it; a submit button buried in the form's own markup cannot be.
   */
  footer?: ReactNode;
  children: ReactNode;
  /** Rendered in the left column at >= 1024. The store's own panel. */
  aside?: ReactNode;
}

/** The structural switch between one column and two. Not a theme token. */
const TWO_COLUMN_WIDTH = 1024;

/** Below this the card goes edge to edge and the action sticks to the bottom. */
const FULL_BLEED_WIDTH = 480;

/** The store's mark: a logo when there is one, initials when there is not. */
function BrandMark({ brand }: { brand: AccessBrand }): JSX.Element | null {
  if (brand.logoUrl) {
    return <Avatar src={brand.logoUrl} alt={brand.name} size="lg" data-testid="access-brand-logo" />;
  }
  if (!brand.initials) return null;
  return (
    <Avatar
      size="lg"
      data-testid="access-brand-initials"
      {...(brand.color ? { style: { backgroundColor: brand.color } } : {})}
    >
      {brand.initials}
    </Avatar>
  );
}

/** Name, mark and subtitle — identical on every screen of the flow. */
export function AccessBrandHeader({ brand }: { brand: AccessBrand }): JSX.Element {
  return (
    <div data-testid="access-brand" data-brand={brand.name}>
      <BrandMark brand={brand} />
      <Heading level="h1">{brand.name}</Heading>
      {brand.subtitle ? (
        <Paragraph data-testid="access-brand-subtitle">{brand.subtitle}</Paragraph>
      ) : null}
    </div>
  );
}

export function AccessCard({
  brand,
  title,
  subtitle,
  footer,
  children,
  aside,
}: AccessCardProps): JSX.Element {
  return (
    <Container variant="centered" padding="lg">
      {/*
        The arrangement is announced on the wrapper so a test — and a host's own
        CSS — can address it without re-deriving the breakpoints. The media
        queries live in the host's stylesheet against these attributes; the
        prototype's own CSS exists so IT can breathe without the library and is
        explicitly not meant to become a stylesheet here.
      */}
      <div
        data-testid="access-card"
        data-full-bleed-below={FULL_BLEED_WIDTH}
        data-two-column-from={TWO_COLUMN_WIDTH}
      >
        {aside ? (
          <div data-testid="access-aside">{aside}</div>
        ) : null}
        <Card>
          <AccessBrandHeader brand={brand} />
          <Heading level="h2" data-testid="access-title">
            {title}
          </Heading>
          {subtitle ? <Paragraph>{subtitle}</Paragraph> : null}
          {children}
        </Card>
        {footer ? (
          // Stuck to the bottom edge below 480 — see the note above. The host's
          // stylesheet reads this marker; the package does not ship the CSS.
          <div data-testid="access-footer" data-sticky-below={FULL_BLEED_WIDTH}>
            {footer}
          </div>
        ) : null}
      </div>
    </Container>
  );
}

export { TWO_COLUMN_WIDTH, FULL_BLEED_WIDTH };
