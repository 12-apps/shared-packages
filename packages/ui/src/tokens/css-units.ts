/**
 * THE ONE READER OF CSS LENGTHS.
 *
 * `HEADING_SCALE` and a host's MUI overrides speak CSS — `'2rem'`, `'-0.02em'`
 * — and both `tokens/theme.ts` and `provider/mui-bridge.ts` need them as
 * numbers. Two private parsers drifted (one multiplied `em` by 16, one did
 * not), so there is one, here, with the rule spelled out: a length becomes px
 * against a 16px root, a tracking value becomes em.
 */

const ROOT_PX = 16;

/** `'1.5rem'` → 24, `'1.5em'` → 24, `'20px'` → 20, `20` → 20, unparseable → `fallback`. */
export function cssLengthToPx(value: string | number | undefined, fallback: number): number {
  if (typeof value === 'number') return value;
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return fallback;
  return value.endsWith('rem') || value.endsWith('em') ? parsed * ROOT_PX : parsed;
}

/** `'-0.02em'` → -0.02, `'0.5px'` → 0.5 / 16, `undefined` → `undefined` ("normal"). */
export function cssTrackingToEm(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return undefined;
  return value.endsWith('px') ? parsed / ROOT_PX : parsed;
}
