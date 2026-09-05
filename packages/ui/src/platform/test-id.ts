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
