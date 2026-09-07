import * as React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Skeleton } from '../../layout/Skeleton/Skeleton.native';

import { freshnessOf } from './FleetMap.helpers';
import type { FleetKeyEvent } from './FleetMap.hooks';
import { FLEET_DOT, FLEET_ROSTER, FLEET_ROW, FLEET_SKELETON } from './FleetMap.metrics';
import type { FleetFreshness, FleetMapCopy, FleetUnit } from './FleetMap.types.native';
import { webAria, webRole } from '../../../platform/aria';
import { webKeyDown } from '../../../platform/web-keys';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { muiTypeStyle } from '../../../tokens/mui-type';
import type { UiTheme } from '../../../tokens/theme';

/**
 * The roster — which on React Native is the WHOLE component, not half of it.
 *
 * On the web this list sits beside a map and carries the information a picture
 * cannot give a screen reader. Here there is no map to sit beside: `MapPreview`
 * has no React Native build, so the native `FleetMap` renders this and says so
 * in `NATIVE-NOTES.md`. That is a smaller change than it sounds, because the
 * web half already treats this list as the component's real content — "the
 * accessible representation, not a sidebar" — and every fact a pin carries is
 * on a row here.
 */

/**
 * `data-freshness`, as something JSX can spread onto a react-native element.
 *
 * Through `dataSet` and NOT as a bare `data-freshness` prop: react-native-web
 * drops unknown props rather than forwarding them, and special-cases only
 * `data-testid`. Measured — the attribute was simply absent from the row, so
 * the shared freshness stories read `null`. `dataSet` is rn-web's documented
 * channel for custom data attributes and renders `data-freshness`; React Native
 * ignores it on a device, which is the same trade `webRole` and `webAria` make.
 *
 * It is not decoration: the SHARED stories read this attribute to assert which
 * threshold a row landed on, so without it they cannot run here at all.
 */
function webDataFreshness(freshness: FleetFreshness): object {
  return { dataSet: { freshness } };
}

/** Each freshness draws from the semantic palette, never a hardcoded hex. */
function freshnessColor(freshness: FleetFreshness, theme: UiTheme): string {
  if (freshness === 'live') return theme.palette.success.main;
  if (freshness === 'lagging') return theme.palette.warning.main;
  return theme.palette.text.disabled;
}

/** Where each row sits inside the scrolling content, and what is on screen. */
interface RosterGeometry {
  rows: Map<string, { y: number; height: number }>;
  offset: number;
  viewport: number;
}

/**
 * Keep the selected row visible INSIDE the roster — the same arithmetic the web
 * does with `scrollTop`, expressed in the only terms React Native has.
 *
 * The web reads `box.offsetTop - list.offsetTop` against `list.scrollTop` and
 * `list.clientHeight`. None of those exist here, so the three numbers are
 * gathered as they arrive: a row's `onLayout` gives its `y` inside the content
 * container (already relative to the list, which is what the web computes by
 * subtraction), the `ScrollView`'s own `onLayout` gives the viewport height,
 * and `onScroll` gives the offset. The comparison below is then line-for-line
 * the web's.
 *
 * `scrollTo` rather than react-native's `scrollToEnd`/`ScrollView.scrollIntoView`
 * for the same reason the web refuses `scrollIntoView({ block: 'nearest' })`:
 * this must move THIS list and nothing else. A native `ScrollView` cannot walk
 * its ancestors, so the hazard is smaller here — but the arithmetic is shared,
 * and two renderers agreeing by construction beats two agreeing by coincidence.
 *
 * Watches `position` as well as the id, because the roster re-sorts on every
 * poll: a rider who stays selected while their staleness moves them down the
 * list would otherwise slide out of view with the effect never re-running.
 */
function useKeptInView(
  scroll: React.RefObject<ScrollView | null>,
  geometry: React.RefObject<RosterGeometry>,
  activeId: string | null,
  position: number,
): void {
  React.useEffect(() => {
    if (activeId === null) return;
    const { rows, offset, viewport } = geometry.current;
    const row = rows.get(activeId);
    // Nothing has laid out yet on the first commit; the next poll re-runs this.
    if (!row || viewport === 0) return;
    if (row.y < offset) {
      scroll.current?.scrollTo({ y: row.y, animated: false });
    } else if (row.y + row.height > offset + viewport) {
      scroll.current?.scrollTo({ y: row.y + row.height - viewport, animated: false });
    }
  }, [scroll, geometry, activeId, position]);
}

/**
 * A row's two lines of text — the name, and the one-line summary under it.
 *
 * Split out of {@link FleetRow} to keep that function under the size gate, and
 * the seam is the natural one: everything here is READ, nothing is interactive.
 */
function RowText({
  unit,
  copy,
  freshness,
  testId,
}: Pick<RowProps, 'unit' | 'copy' | 'freshness' | 'testId'>): React.JSX.Element {
  const theme = useUiTheme();

  // Dropped rather than rendered empty: a phone that reports no accuracy radius
  // would otherwise print a trailing separator with nothing after it.
  const meta = [
    copy.freshness[freshness],
    copy.lastSeen(unit.staleSeconds),
    unit.accuracyM == null ? null : copy.accuracy(unit.accuracyM),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <View style={styles.rowText}>
      <Text
        testID={`${testId}-label`}
        style={[muiTypeStyle(theme, 'body2'), styles.label, { color: theme.palette.text.primary }]}
      >
        {unit.label}
      </Text>
      <Text
        testID={`${testId}-meta`}
        style={[muiTypeStyle(theme, 'caption'), { color: theme.palette.text.secondary }]}
      >
        {meta}
      </Text>
    </View>
  );
}

interface RowProps {
  unit: FleetUnit;
  copy: FleetMapCopy;
  freshness: FleetFreshness;
  selected: boolean;
  onSelect: (id: string) => void;
  onMeasured: (id: string, y: number, height: number) => void;
  /** The row's own DOM id, which `aria-activedescendant` points at. */
  optionId: string;
  testId: string;
}

/**
 * One roster row.
 *
 * A `Pressable` rather than a `View` with an `onClick`: a press is the input on
 * a device, and `Pressable` is what gives the row its pressed state and its
 * accessibility role in one element. The PRESSED wash stands in for the web's
 * hover — and, as on the web, it must never weaken the selection, so a selected
 * row keeps `action.selected` whether or not a finger is on it.
 */
function FleetRow({
  unit,
  copy,
  freshness,
  selected,
  onSelect,
  onMeasured,
  optionId,
  testId,
}: RowProps): React.JSX.Element {
  const theme = useUiTheme();

  const measure = React.useCallback(
    (event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      onMeasured(unit.id, y, height);
    },
    [onMeasured, unit.id],
  );

  return (
    <Pressable
      {...webRole('option')}
      {...webDataFreshness(freshness)}
      // Without this the roster's `aria-activedescendant` names an element that
      // does not exist, which announces nothing and fails an axe audit — worse
      // than omitting the attribute. Measured: the row carried no id at all.
      id={optionId}
      // BOTH, and neither is redundant. `accessibilityState` is what a DEVICE
      // reads; react-native-web does not turn it into `aria-selected`, so
      // without the attribute beside it the web build conveys the selection by
      // background colour alone — which is the one thing this component refuses
      // to do for freshness, and no more acceptable here.
      accessibilityState={{ selected }}
      aria-selected={selected}
      testID={testId}
      onPress={() => onSelect(unit.id)}
      onLayout={measure}
      style={({ pressed }) => [
        styles.row,
        {
          gap: theme.spacing(FLEET_ROW.gapUnits),
          paddingVertical: theme.spacing(FLEET_ROW.paddingYUnits),
          paddingHorizontal: theme.spacing(FLEET_ROW.paddingXUnits),
          borderRadius: FLEET_ROW.radiusMultiple * theme.radius.md,
          backgroundColor: selected
            ? theme.palette.action.selected
            : pressed
              ? theme.palette.action.hover
              : 'transparent',
        },
      ]}
    >
      {/* The dot repeats what the freshness word beside it already says, so it
          is hidden rather than read twice — and colour is never the only
          carrier of the state. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={`${testId}-dot`}
        style={[styles.dot, { backgroundColor: freshnessColor(freshness, theme) }]}
      />
      <RowText unit={unit} copy={copy} freshness={freshness} testId={testId} />
      {unit.badge !== undefined && unit.badge !== '' && (
        <Text
          testID={`${testId}-badge`}
          style={[
            muiTypeStyle(theme, 'caption'),
            styles.badge,
            { color: theme.palette.text.secondary },
          ]}
        >
          {unit.badge}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * What stands in for the roster before any unit has landed.
 *
 * Hidden from the reader, because three grey bars are not information — the
 * panel's busy state and its optional announcement carry that. The radius is
 * the same MULTIPLE a real row uses rather than a raw pixel count.
 */
function FirstLoad({ testId }: { testId: string }): React.JSX.Element {
  const theme = useUiTheme();
  return (
    <View
      testID={`${testId}-skeleton`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ gap: theme.spacing(FLEET_SKELETON.gapUnits) }}
    >
      {Array.from({ length: FLEET_SKELETON.rows }, (_, row) => (
        <Skeleton
          key={row}
          variant="rectangular"
          height={FLEET_SKELETON.height}
          borderRadius={FLEET_SKELETON.radiusMultiple}
        />
      ))}
    </View>
  );
}

export interface FleetRosterProps {
  units: readonly FleetUnit[];
  copy: FleetMapCopy;
  selectedId: string | null | undefined;
  onSelect: (id: string) => void;
  laggingAfterSeconds: number;
  staleAfterSeconds: number;
  loading: boolean;
  maxHeight: number | undefined;
  testId: string;
  onKeyDown: (event: FleetKeyEvent) => void;
}

export function FleetRoster({
  units,
  copy,
  selectedId,
  onSelect,
  laggingAfterSeconds,
  staleAfterSeconds,
  loading,
  maxHeight,
  testId,
  onKeyDown,
}: FleetRosterProps): React.JSX.Element {
  const theme = useUiTheme();
  const scroll = React.useRef<ScrollView>(null);
  const geometry = React.useRef<RosterGeometry>({ rows: new Map(), offset: 0, viewport: 0 });

  // Generated, not derived from `dataTestId`: two boards on one screen filtered
  // from the same fleet would otherwise emit duplicate ids and an ambiguous
  // `aria-activedescendant` under react-native-web.
  const rowIdPrefix = React.useId();

  // The selection is CONTROLLED, so it can name a unit that has since dropped
  // out of the freshness window — a courier ending their shift mid-poll. The
  // attribute must then be absent rather than pointing at a row that no longer
  // renders. `mapCentre` and `nextSelection` both handle the same case.
  const active = units.some((unit) => unit.id === selectedId) ? (selectedId ?? null) : null;
  const position = active === null ? -1 : units.findIndex((unit) => unit.id === active);

  const onMeasured = React.useCallback((id: string, y: number, height: number) => {
    geometry.current.rows.set(id, { y, height });
  }, []);

  useKeptInView(scroll, geometry, active, position);

  if (loading && units.length === 0) return <FirstLoad testId={testId} />;

  return (
    <ScrollView
      ref={scroll}
      {...webRole('listbox')}
      // A single tab stop with the arrow keys inside it, which is the listbox
      // pattern and what `aria-activedescendant` below is for: a dispatcher
      // tabbing past a fleet of thirty should not press it thirty times. React
      // Native has no tab order, so this reaches the DOM through
      // react-native-web and does nothing on a device — where each row is its
      // own touch target anyway.
      tabIndex={0}
      {...webAria({ 'aria-activedescendant': active ? `${rowIdPrefix}-${active}` : undefined })}
      {...webKeyDown(onKeyDown)}
      accessibilityLabel={copy.rosterLabel}
      testID={`${testId}-roster`}
      style={maxHeight === undefined ? undefined : { maxHeight }}
      contentContainerStyle={{ gap: theme.spacing(FLEET_ROSTER.gapUnits) }}
      onLayout={(event: LayoutChangeEvent) => {
        geometry.current.viewport = event.nativeEvent.layout.height;
      }}
      onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        geometry.current.offset = event.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={16}
    >
      {units.map((unit) => (
        <FleetRow
          key={unit.id}
          unit={unit}
          copy={copy}
          freshness={freshnessOf(unit.staleSeconds, laggingAfterSeconds, staleAfterSeconds)}
          selected={unit.id === active}
          onSelect={onSelect}
          onMeasured={onMeasured}
          optionId={`${rowIdPrefix}-${unit.id}`}
          testId={`${testId}-${unit.id}`}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  badge: { flexShrink: 0 },
  dot: {
    borderRadius: FLEET_DOT.size / 2,
    flexShrink: 0,
    height: FLEET_DOT.size,
    width: FLEET_DOT.size,
  },
  label: { fontWeight: '500' },
  row: { alignItems: 'center', flexDirection: 'row' },
  rowText: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
});
