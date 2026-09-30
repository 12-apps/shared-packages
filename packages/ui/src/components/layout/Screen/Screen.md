# Screen

`@12-apps/ui/layout/Screen` is a bounded page viewport on web, Android and iOS.
It combines safe-area edges, vertical scrolling and native keyboard avoidance.
It renders existing Box/Stack/form components without consumer imports from a
visual platform library. It is for ordinary screens, not virtualized lists.

```tsx
import { Screen } from '@12-apps/ui/layout/Screen';
import { Text } from '@12-apps/ui/typography/Text';

<Screen p={2} gap={2} safeAreaEdges={['top', 'left', 'right']}>
  <Text>Content above a navigator-owned bottom tab bar</Text>
</Screen>
```

## Props

- `children`: screen content
- `scroll` (true): a vertical scrolling viewport; use false if a child owns scrolling
- `safeAreaEdges` (all four): physical edges; use an empty array when an ancestor
  already owns every inset. Exclude bottom when a tab bar owns that edge
- `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl`, `gap`: content spacing in theme units,
  inside the safe area; side overrides axis, axis overrides shorthand
- `bg` (`default`): the same surface/palette role as Box
- `keyboardAvoiding` (true): native keyboard lift; disable if a parent owns it
- `keyboardVerticalOffset` (0): native distance from the window top to the
  screen's parent, in dp; set for a non-overlay navigation header
- `testID` / `dataTestId`: outer screen id; scroll viewport also has `<id>-viewport`
- Native: View accessibility props, `style`, `contentContainerStyle`,
  `scrollViewProps` for scroll callbacks and indicators
- Web: div accessibility props, `sx`, `contentSx`, `style`
- Ref: native outer View / web outer div

## Native setup

Install the optional peer `react-native-safe-area-context` (5+) using the version
supported by your Expo/RN app. A web-only consumer does not need this peer. Screen
reuses the navigator's safe-area context. Without one it creates a provider
outside the scroll viewport. Do not wrap Screen in another safe-area view;
select the edges the screen actually owns instead.

The safe-area view wraps React Native's KeyboardAvoidingView, which uses padding
on iOS and height on Android. Its measured viewport already excludes the bottom
safe area, so the home-indicator inset is not added again above the keyboard.
ScrollView automatic keyboard and content insets are off so those owners do not
also apply the same lift/insets. Handled child taps remain usable with the
keyboard open; dragging dismisses it. `scrollViewProps` can change tap/dismiss
policy, but cannot override the viewport geometry or automatic inset ownership.

## Layout and accessibility

The parent must give Screen a bounded height (a navigator does this). On the web,
the ancestor chain must carry a definite height/flex size; Screen grows within it.
Content has a minimum viewport height, so short screens fill the available area
and long screens scroll. No app-specific padding, colors, header or footer are
invented. Use a meaningful accessibility label where the screen needs one;
children retain their own focus and accessibility semantics.

The web uses CSS `env(safe-area-inset-*)`; set viewport-fit=cover when deploying
edge-to-edge. Browser keyboard/visual-viewport behavior belongs to the browser;
the native keyboard props are accepted but not forwarded to the DOM.

## Verification boundary

Shared Storybook tests prove bounded scrolling and text entry on both browser
renderers. Native unit tests exercise safe-area/keyboard/scroll ownership and
rerenders, but react-native-web does not simulate a device keyboard. Device QA
must cover both OSes, a notched screen, bottom tabs, keyboard show/hide/resize,
last-field reachability, rotation and Android back dismissal before claiming
that those device behaviors have been observed.
