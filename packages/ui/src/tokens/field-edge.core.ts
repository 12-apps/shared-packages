import {
  darken,
  decomposeColor,
  getContrastRatio,
  getLuminance,
  hslToRgb,
  lighten,
  recomposeColor,
} from './color';

/**
 * THE FIELD EDGE, WITH NO RENDERER BEHIND IT.
 *
 * The argument for why an outlined control cannot draw its resting boundary
 * from `alpha(theme.palette.divider, 0.23)` is in `./field-edge.ts`, next to
 * the MUI-typed `fieldEdge` the web components call. This file is the WALK
 * itself, over two colour strings, so the native renderer can run it too:
 * `Input.native.tsx` and `Select.native.tsx` have no MUI `Theme` to pass and no
 * `@mui/material/styles` to import, and a second copy of the walk beside them
 * is a second answer to "where is this field's border" waiting to drift.
 *
 * `./color` is a faithful port of MUI's colour manipulator (asserted equal to
 * it in `./__tests__/color.test.ts`), so the string this returns is the string
 * the web has always emitted.
 */

/**
 * WCAG 2.1 SC 1.4.11 — the contrast a control's own boundary owes the surface
 * behind it. See `./field-edge.ts` for why 3:1 and why it is a floor.
 */
export const MIN_UI_CONTRAST = 3;

/** How far one step of the walk moves, and how many steps before it gives up. */
const STEP = 0.05;
const MAX_STEPS = 20;

/** A colour's red, green, blue and alpha, with `hsl()` converted on the way. */
function channels(colour: string): [number, number, number, number] {
  const decomposed = decomposeColor(colour);
  const rgb = decomposed.type.startsWith('hsl') ? decomposeColor(hslToRgb(colour)) : decomposed;
  const [r, g, b, a] = rgb.values;
  return [r ?? 0, g ?? 0, b ?? 0, a ?? 1];
}

/**
 * A colour as an opaque `rgb()`, with any translucency resolved against
 * `surface`.
 *
 * Needed because `getContrastRatio` reads the channels it is given and ignores
 * the alpha, so handing it an `rgba()` measures a colour nobody sees.
 */
function flatten(colour: string, surface: string): string {
  const [r, g, b, alpha] = channels(colour);
  if (alpha >= 1) return recomposeColor({ type: 'rgb', values: [r, g, b] });

  const [baseR, baseG, baseB] = channels(surface);
  const blend = (fg: number, bg: number): number => Math.round(alpha * fg + (1 - alpha) * bg);
  return recomposeColor({
    type: 'rgb',
    values: [blend(r, baseR), blend(g, baseG), blend(b, baseB)],
  });
}

/**
 * The resting boundary a control draws on `surface`, from the theme's own
 * `divider` as the seed: the seed itself when it already clears
 * {@link MIN_UI_CONTRAST}, otherwise the nearest tone of it that does.
 */
export function resolveFieldEdge(divider: string, surface: string): string {
  const ground = flatten(surface, '#FFFFFF');
  const seed = flatten(divider, ground);
  if (getContrastRatio(seed, ground) >= MIN_UI_CONTRAST) return seed;

  // Away from the surface, whichever way that is — so one rule serves both
  // modes, and a dark card in a light theme is still handled by the pair rather
  // than by `palette.mode`.
  const away = getLuminance(ground) > 0.5 ? darken : lighten;
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    // From the SEED each time rather than compounding the previous result, so
    // the walk lands on the nearest passing tone instead of overshooting past it.
    const candidate = away(seed, step * STEP);
    if (getContrastRatio(candidate, ground) >= MIN_UI_CONTRAST) return candidate;
  }
  // Unreachable for any real surface — black clears 21:1 on white and white
  // clears it on black — but a caller must never be handed `undefined`.
  return getLuminance(ground) > 0.5 ? '#000000' : '#FFFFFF';
}
