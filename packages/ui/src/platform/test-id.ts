/**
 * One test id, three spellings.
 *
 * The web components take `dataTestId` and forward it as `data-testid`; the
 * existing test stories pass `'data-testid'` straight through as an unknown
 * prop; React Native calls the same thing `testID`, and react-native-web turns
 * THAT back into `data-testid`. A native component that honoured only one of
 * the three would pass its own unit tests and fail the shared stories.
 */
export interface TestIdProps {
  testID?: string;
  dataTestId?: string;
  'data-testid'?: string;
}

/** The id the caller asked for under any of the three names, else `fallback`. */
export function resolveTestId(props: TestIdProps, fallback?: string): string | undefined {
  return props.testID ?? props.dataTestId ?? props['data-testid'] ?? fallback;
}

/**
 * The id under whichever of the three spellings the caller used, together with
 * the props stripped of all three — so a web component can put `data-testid`
 * where the DOM wants it without React seeing `testID` or `dataTestId` and
 * warning that it does not recognise them.
 */
export function splitTestId<T extends TestIdProps>(
  props: T,
  fallback?: string,
): { testId: string | undefined; rest: Omit<T, keyof TestIdProps> } {
  return { testId: resolveTestId(props, fallback), rest: withoutTestIdProps(props) };
}

/** `${id}-${suffix}` for a sub-element, or `${fallback}-${suffix}` when unnamed. */
export function childTestId(
  props: TestIdProps,
  suffix: string,
  fallback: string,
): string {
  return `${resolveTestId(props, fallback) ?? fallback}-${suffix}`;
}

/** `props` without any of the three spellings, for spreading onto a native element. */
export function withoutTestIdProps<P extends TestIdProps>(props: P): Omit<P, keyof TestIdProps> {
  const { testID: _testID, dataTestId: _dataTestId, 'data-testid': _dataTestid, ...rest } = props;
  return rest;
}

/**
 * A SLOT's own test id, where a raw id means "this element" and `dataTestId`
 * means "the surface I belong to".
 *
 * `Dialog` names its parts by derivation — `d` gives `d-title`, `d-content`,
 * `d-actions` — and a slot receives the DIALOG's id in `dataTestId` to derive
 * from. A raw `data-testid` (or React Native's `testID`) is something else: it
 * is the id the caller wants ON THIS ELEMENT, which is how the shared stories
 * address a `DialogContent`, so it is taken verbatim and no suffix is added.
 *
 * Both renderers read this one function, which is the only way the web and the
 * native slot can agree about what `<DialogContent data-testid="x">` is called.
 */
export function slotTestId(props: TestIdProps, suffix: string, fallback: string): string {
  return props.testID ?? props['data-testid'] ?? childTestId(props, suffix, fallback);
}
