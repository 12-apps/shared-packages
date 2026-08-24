/**
 * The four meanings survive a tenant's brand (FUT-810 rules 9 and 10), and the two
 * knobs the extraction added do what they say.
 *
 * Split out of the brand-palette suite because these are the only cases that need
 * MUI: everything below the theme is arithmetic on hexes and is asserted there.
 */
import { describe, expect, it } from 'vitest';

import { contrastRatio, DEFAULT_SURFACE, MIN_TEXT_CONTRAST } from '../../core/brand-palette';
import { createAppTheme, DEFAULT_SURFACES, DEFAULT_THEME_TOKENS } from '../theme';

describe('createAppTheme semantics (FUT-810 rule 9)', () => {
  it('never derives a semantic from the tenant brand', () => {
    // Two completely different brands, same four meanings. This is the whole claim
    // of rule 9: the tenant owns the primary, not what "danger" means.
    const purple = createAppTheme('light', { override: { primary: '#5B57E0' } });
    const teal = createAppTheme('light', { override: { primary: '#0E9F6E' } });
    expect(purple.palette.success.main).toBe(teal.palette.success.main);
    expect(purple.palette.error.main).toBe(teal.palette.error.main);
    expect(purple.palette.info.main).toBe(teal.palette.info.main);
  });

  it('rotates the one semantic a red brand lands on, and only that one', () => {
    const plain = createAppTheme('light');
    const red = createAppTheme('light', { override: { primary: '#D92D20' } });
    expect(red.palette.error.main).not.toBe(plain.palette.error.main);
    expect(red.palette.success.main).toBe(plain.palette.success.main);
    expect(red.palette.info.main).toBe(plain.palette.info.main);
  });

  it('rotates the warning off an amber brand', () => {
    const plain = createAppTheme('light');
    const amber = createAppTheme('light', { override: { primary: '#F5C518' } });
    expect(amber.palette.warning.main).not.toBe(plain.palette.warning.main);
    expect(amber.palette.error.main).toBe(plain.palette.error.main);
  });
});

describe('createAppTheme palette', () => {
  it('paints the platform tokens when no tenant seed is given', () => {
    expect(createAppTheme('light').palette.primary.main).toBe(DEFAULT_THEME_TOKENS.light.primary);
    expect(createAppTheme('dark').palette.primary.main).toBe(DEFAULT_THEME_TOKENS.dark.primary);
  });

  /**
   * The reason `brandRole` corrects `main` rather than leaving it to call sites: a
   * tenant's unreadable lime has to come back legible from the ONE token every
   * component reaches for, or the guarantee is a list of places somebody remembered.
   */
  it('corrects a tenant seed to a legible tone, keeping the exact hex as light', () => {
    const lime = createAppTheme('light', { override: { primary: '#7ED957' } });
    expect(contrastRatio('#7ED957', '#FFFFFF')).toBeLessThan(MIN_TEXT_CONTRAST);
    expect(contrastRatio(lime.palette.primary.main, '#FFFFFF')).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
    expect(lime.palette.primary.light).toBe('#7ED957');
  });

  it('leaves a tenant secondary alone when only a primary was set', () => {
    const theme = createAppTheme('light', { override: { primary: '#5B57E0' } });
    expect(theme.palette.secondary.main).toBe(DEFAULT_THEME_TOKENS.light.secondary);
  });

  /**
   * The extraction's own knob: a host's design tokens are a host's own. Asserted
   * because a `tokens` option read for one mode and ignored for the other would look
   * right on every screen a developer happens to open.
   */
  it('takes the host platform tokens over its own defaults', () => {
    const tokens = { light: { primary: '#112233', secondary: '#445566' } };
    const theme = createAppTheme('light', { tokens });
    expect(theme.palette.primary.main).toBe('#112233');
    expect(theme.palette.secondary.main).toBe('#445566');
  });

  it('falls back to its own tokens for a mode the host did not override', () => {
    const tokens = { light: { primary: '#112233', secondary: '#445566' } };
    expect(createAppTheme('dark', { tokens }).palette.primary.main).toBe(
      DEFAULT_THEME_TOKENS.dark.primary,
    );
  });

  /**
   * The surface is the hex the legibility correction is computed AGAINST, so a host
   * whose page is a dark card and whose theme thinks it is white gets a seed corrected
   * to 4.5:1 against a background it never paints — the guarantee holding on paper and
   * not on screen. The default is the core's own `DEFAULT_SURFACE`, not a second copy
   * of the same white.
   */
  it('corrects the seed against the surface the host says it paints', () => {
    expect(DEFAULT_SURFACES.light).toBe(DEFAULT_SURFACE);

    const seed = '#7ED957';
    const onWhite = createAppTheme('light', { override: { primary: seed } });
    const onSlate = createAppTheme('light', {
      override: { primary: seed },
      surface: { light: '#1F2933' },
    });

    // A different surface is a different answer, and each clears the floor against the
    // surface it was told about.
    expect(onSlate.palette.primary.main).not.toBe(onWhite.palette.primary.main);
    expect(contrastRatio(onSlate.palette.primary.main, '#1F2933')).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
    expect(contrastRatio(onWhite.palette.primary.main, DEFAULT_SURFACE)).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
    // The exact swatch still survives for decoration, whatever the surface.
    expect(onSlate.palette.primary.light).toBe(seed);
  });

  it('takes a surface for one mode without losing the other', () => {
    const surface = { dark: '#000000' };
    const light = createAppTheme('light', { override: { primary: '#7ED957' }, surface });
    const bare = createAppTheme('light', { override: { primary: '#7ED957' } });
    expect(light.palette.primary.main).toBe(bare.palette.primary.main);
  });
});

/**
 * A theme is not only a palette.
 *
 * A host arrives with `styleOverrides` and `defaultProps` of its own — the
 * extraction origin carries ~240 lines of them for a glass treatment on
 * `MuiAlert` alone. Before `components` existed here, adopting this factory
 * dropped every one of them: no type error, no failing test, a still-valid
 * theme, and the only symptom a component that stops looking the way the
 * product designed it, in every app at once.
 *
 * That is why these assert the OVERRIDE SURVIVES rather than that the key is
 * accepted — accepting it and discarding it would pass the weaker test.
 */
describe('createAppTheme components', () => {
  const overrides = {
    MuiAlert: { styleOverrides: { root: { backdropFilter: 'blur(8px)' } } },
  } as const;

  it("keeps the host's component overrides", () => {
    const theme = createAppTheme('light', { components: overrides });

    expect(theme.components?.MuiAlert?.styleOverrides?.root).toEqual({
      backdropFilter: 'blur(8px)',
    });
  });

  it('leaves the palette to the factory, overrides or not', () => {
    const seed = '#7ED957';
    const bare = createAppTheme('light', { override: { primary: seed } });
    const styled = createAppTheme('light', { override: { primary: seed }, components: overrides });

    // The two halves are independent: a host restyling its alerts must not move
    // the legibility-corrected brand colour underneath them.
    expect(styled.palette.primary.main).toBe(bare.palette.primary.main);
  });

  it('builds the same theme as before when a host passes none', () => {
    // The key is additive. A host that never heard of it gets byte-identical
    // options, which is what makes this a minor rather than a break.
    const withKey = createAppTheme('dark', { components: undefined });
    const without = createAppTheme('dark');

    expect(withKey.palette.primary.main).toBe(without.palette.primary.main);
    expect(withKey.components).toEqual(without.components);
  });
});

/**
 * A HOST's own primary is a brand too.
 *
 * `separateFromBrand` was written for one failure and states it plainly: a brand
 * that lands on the danger hue makes 'Remover' and 'Adicionar' the same colour,
 * and the one distinction on the screen that must never be missed is the one
 * that disappears. The rotation guarding against it only ever read the TENANT's
 * seed — so it fired for stores that paid to replace the palette and never once
 * for the platform's own screens, which is most of the product.
 */
describe('createAppTheme semantics vs the host token', () => {
  // 4° from this module's own danger anchor. A real palette: the primary of a
  // warm brand whose manual argues, by name, against danger sharing it.
  const WARM_RED = '#D42B1F';

  it('rotates a semantic off the host primary, with no tenant in sight', () => {
    const plain = createAppTheme('light');
    const warm = createAppTheme('light', {
      tokens: { light: { primary: WARM_RED, secondary: '#EE7B1F' } },
    });

    expect(warm.palette.error.main).not.toBe(plain.palette.error.main);
    // And only that one: the brand collides with danger, not with the meanings
    // sitting elsewhere on the wheel.
    expect(warm.palette.success.main).toBe(plain.palette.success.main);
    expect(warm.palette.info.main).toBe(plain.palette.info.main);
  });

  it('leaves the host token itself alone', () => {
    // The semantic yields, never the brand — the host chose that hex.
    const warm = createAppTheme('light', {
      tokens: { light: { primary: WARM_RED, secondary: '#EE7B1F' } },
    });

    expect(warm.palette.primary.main).toBe(WARM_RED);
  });

  it('lets the tenant seed win over the host token as the thing to avoid', () => {
    // A white-labelled store's buttons are ITS colour, so that is the one a
    // semantic can be confused with. The host's token is not on screen.
    const amberTenantOnRedHost = createAppTheme('light', {
      tokens: { light: { primary: WARM_RED, secondary: '#EE7B1F' } },
      override: { primary: '#F5C518' },
    });
    const plain = createAppTheme('light');

    expect(amberTenantOnRedHost.palette.warning.main).not.toBe(plain.palette.warning.main);
    expect(amberTenantOnRedHost.palette.error.main).toBe(plain.palette.error.main);
  });
});

/**
 * The three keys a host had no way to state, and the one trap they remove.
 */
describe('createAppTheme grounds, rule and meanings', () => {
  const SAL = '#FDF8F2';
  const LINHA = '#EBD9C7';

  it('paints the grounds the host says it paints', () => {
    const theme = createAppTheme('light', {
      background: { light: { default: SAL, paper: '#FFFFFF' } },
    });

    expect(theme.palette.background.default).toBe(SAL);
    expect(theme.palette.background.paper).toBe('#FFFFFF');
  });

  it('keeps MUI’s ground for a mode the host did not state', () => {
    const theme = createAppTheme('dark', {
      background: { light: { default: SAL, paper: '#FFFFFF' } },
    });

    expect(theme.palette.background.default).toBe(createAppTheme('dark').palette.background.default);
  });

  it('rules with the host’s hairline', () => {
    expect(createAppTheme('light', { divider: { light: LINHA } }).palette.divider).toBe(LINHA);
  });

  it('takes the host’s own meanings verbatim, without rotating them', () => {
    // Stated danger sits 4° from the brand — exactly where the rotation would
    // fire on an anchor. It must not fire here: the host looked at both hexes
    // and decided, and a factory second-guessing that moves a chosen colour.
    const theme = createAppTheme('light', {
      tokens: { light: { primary: '#D42B1F', secondary: '#EE7B1F' } },
      semantics: { light: { error: '#7C2A1C', success: '#4E7A2B' } },
    });

    expect(theme.palette.error.main).toBe('#7C2A1C');
    expect(theme.palette.success.main).toBe('#4E7A2B');
  });

  it('falls back per meaning, not all-or-nothing', () => {
    const theme = createAppTheme('light', { semantics: { light: { error: '#7C2A1C' } } });

    expect(theme.palette.error.main).toBe('#7C2A1C');
    expect(theme.palette.info.main).toBe(createAppTheme('light').palette.info.main);
  });

  /**
   * The trap these keys would otherwise ADD: `surface` and `background.default`
   * are the same page asked about twice, and two spellings of one fact drift.
   */
  it('measures legibility against the ground the host paints', () => {
    const tinted = '#3A1010';
    const theme = createAppTheme('light', {
      background: { light: { default: tinted, paper: tinted } },
      override: { primary: '#7ED957' },
    });

    // Corrected against the DARK page it actually paints, so the seed is allowed
    // to stay bright — against white it would have been driven darker.
    expect(contrastRatio(theme.palette.primary.main, tinted)).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
  });

  it('lets an explicit surface win over the painted ground', () => {
    // Not the same question: a host may read its tenant's text against a card
    // rather than against the page behind it.
    const onCard = createAppTheme('light', {
      background: { light: { default: '#3A1010', paper: '#FFFFFF' } },
      surface: { light: '#FFFFFF' },
      override: { primary: '#7ED957' },
    });

    expect(contrastRatio(onCard.palette.primary.main, '#FFFFFF')).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
  });

  it('builds the same palette as before when a host states none of them', () => {
    // All three are additive. A host that never heard of them gets what it got.
    const withKeys = createAppTheme('light', {
      background: undefined,
      divider: undefined,
      semantics: undefined,
    });
    const without = createAppTheme('light');

    expect(withKeys.palette.background).toEqual(without.palette.background);
    expect(withKeys.palette.divider).toBe(without.palette.divider);
    expect(withKeys.palette.error.main).toBe(without.palette.error.main);
  });
});
