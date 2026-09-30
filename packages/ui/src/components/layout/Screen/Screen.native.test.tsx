import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Screen } from './Screen.native';
import { UiProvider } from '../../../provider/UiProvider.native';

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    Platform: { ...actual.Platform, get OS() { return actual.Platform.OS; } },
    KeyboardAvoidingView: vi.fn((props) => React.createElement(actual.KeyboardAvoidingView, props)),
    ScrollView: vi.fn((props) => React.createElement(actual.ScrollView, props)),
  };
});
vi.mock('react-native-safe-area-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native-safe-area-context')>();
  return {
    ...actual,
    SafeAreaProvider: vi.fn((props) => React.createElement(actual.SafeAreaProvider, {
      // jsdom has no physical safe-area measurement; production does not seed
      // remounting providers with potentially stale initialWindowMetrics.
      initialMetrics: { frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 24, right: 0, bottom: 16, left: 0 } },
      ...props,
    })),
    SafeAreaView: vi.fn((props) => React.createElement(actual.SafeAreaView, props)),
  };
});
const insets = { top: 24, right: 4, bottom: 16, left: 4 };
function wrap(children: React.ReactNode): React.JSX.Element {
  return <SafeAreaInsetsContext.Provider value={insets}><UiProvider theme={{ spacingUnit: 4 }}>{children}</UiProvider></SafeAreaInsetsContext.Provider>;
}
const lastProps = (component: unknown): Record<string, unknown> => vi.mocked(component as ReturnType<typeof vi.fn>).mock.lastCall![0];
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('Screen (native)', () => {
  it('owns a safe-area provider only when the navigator has none', () => {
    const { unmount } = render(<Screen dataTestId="standalone" />);
    expect(SafeAreaProvider).toHaveBeenCalledTimes(1);
    expect(lastProps(SafeAreaProvider)).not.toHaveProperty('initialMetrics');
    expect(screen.getByTestId('standalone')).toBeInTheDocument();
    unmount();
    vi.clearAllMocks();
    render(wrap(<Screen dataTestId="nested" />));
    expect(SafeAreaProvider).not.toHaveBeenCalled();
    expect(screen.getByTestId('nested')).toBeInTheDocument();
  });
  it('uses selected safe-area edges and owns native scroll insets exactly once', () => {
    render(wrap(<Screen dataTestId="page" p={2} gap={1} safeAreaEdges={['top', 'left', 'right']} />));
    expect(lastProps(SafeAreaView).edges).toEqual(['top', 'left', 'right']);
    // Structural ownership; actual device keyboard geometry is a separate QA lane.
    expect((lastProps(SafeAreaView).children as React.ReactElement).type).toBe(KeyboardAvoidingView);
    expect(lastProps(ScrollView)).toMatchObject({
      horizontal: false, keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag',
      automaticallyAdjustKeyboardInsets: false, automaticallyAdjustContentInsets: false, contentInsetAdjustmentBehavior: 'never',
    });
    expect(screen.getByTestId('page-viewport').firstElementChild).toHaveStyle({ paddingTop: '8px', gap: '4px', flexGrow: '1' });
  });
  it.each(['ios', 'android'] as const)('selects the %s keyboard behavior and parent offset', (platform) => {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue(platform);
    render(wrap(<Screen keyboardVerticalOffset={48} />));
    expect(lastProps(KeyboardAvoidingView)).toMatchObject({ enabled: true, behavior: platform === 'ios' ? 'padding' : 'height', keyboardVerticalOffset: 48 });
  });
  it('turns off scrolling and keyboard avoidance without losing children', () => {
    render(wrap(<Screen dataTestId="page" scroll={false} keyboardAvoiding={false}><Screen dataTestId="child" scroll={false} keyboardAvoiding={false} /></Screen>));
    expect(ScrollView).not.toHaveBeenCalled();
    expect(lastProps(KeyboardAvoidingView)).toMatchObject({ enabled: false, behavior: undefined });
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
  it('updates edge choices, scroll mode and keyboard policy on rerender', async () => {
    const { rerender } = render(wrap(<Screen dataTestId="page" />));
    expect(lastProps(SafeAreaView).edges).toEqual(['top', 'right', 'bottom', 'left']);
    expect(screen.getByTestId('page-viewport')).toBeInTheDocument();
    rerender(wrap(<Screen dataTestId="page" safeAreaEdges={[]} scroll={false} keyboardAvoiding={false} />));
    expect(lastProps(SafeAreaView).edges).toEqual([]);
    expect(lastProps(KeyboardAvoidingView)).toMatchObject({ enabled: false, behavior: undefined });
    await waitFor(() => expect(screen.queryByTestId('page-viewport')).not.toBeInTheDocument());
  });
  it('forwards accessibility, root styles and scroll callbacks', () => {
    const onScroll = vi.fn();
    render(wrap(<Screen dataTestId="page" accessibilityLabel="Workout" style={{ opacity: 0.5 }} scrollViewProps={{ onScroll, keyboardShouldPersistTaps: 'always' }} />));
    expect(screen.getByTestId('page')).toHaveAttribute('aria-label', 'Workout');
    expect(screen.getByTestId('page')).toHaveStyle({ opacity: '0.5' });
    expect(lastProps(ScrollView)).toMatchObject({ onScroll, keyboardShouldPersistTaps: 'always' });
  });
});
