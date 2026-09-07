import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../EmptyState/EmptyState.native';

import { useFleetMap } from './FleetMap.hooks';
import {
  FLEET_DEFAULT_LAGGING_AFTER_SECONDS,
  FLEET_DEFAULT_STALE_AFTER_SECONDS,
  FLEET_PANEL,
} from './FleetMap.metrics';
import type { FleetMapProps } from './FleetMap.types.native';
import { FleetRoster } from './FleetRoster.native';
import { webAria, webRole } from '../../../platform/aria';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { MUI_FONT_WEIGHT_MEDIUM, muiTypeStyle } from '../../../tokens/mui-type';

/**
 * The reload announcement, and nothing else.
 *
 * A busy region marks itself stale for assistive technology but UTTERS nothing,
 * and the skeletons beside it are hidden from the reader — so a screen-reader
 * user got silence while the roster reloaded. This is the utterance.
 *
 * Optional by design: the sentence is in the reader's language, which only the
 * caller knows, and inventing an English one in a component whose whole premise
 * is that every word arrives through `copy` would be the bug it exists to
 * avoid. No `copy.loading`, no region.
 *
 * ## The node outlives the text, and that is the whole trick
 *
 * A live region has to exist BEFORE its content changes; a reader watches an
 * existing region for mutations rather than announcing one that appears already
 * populated. Mounting region-and-text together in a single commit is the classic
 * silent case — it satisfies a query while announcing nothing. So the region
 * mounts as soon as the caller offers the copy and merely EMPTIES when idle.
 *
 * `role="status"` and `aria-live` reach the DOM through react-native-web; on a
 * device the announcement is made by `AccessibilityInfo` or not at all, which
 * is recorded in `NATIVE-NOTES.md` rather than papered over here.
 */
function FleetStatus({
  announcement,
  loading,
  testId,
}: {
  announcement: string | undefined;
  loading: boolean;
  testId: string;
}): React.JSX.Element | null {
  // No copy, no region at all — the caller has not asked for an announcement.
  if (announcement === undefined) return null;
  return (
    <View
      {...webRole('status')}
      aria-live="polite"
      accessibilityLiveRegion="polite"
      testID={`${testId}-status`}
      style={styles.srOnly}
    >
      <Text>{loading ? announcement : ''}</Text>
    </View>
  );
}

/**
 * FleetMap on React Native — where a set of tracked units is right now.
 *
 * Product-free by construction: it draws a labelled row with a freshness, and
 * every word — the heading, the three freshness states, how a duration and a
 * distance are written — arrives through `copy`. Couriers, service vans and
 * field engineers are all the same list.
 *
 * ## What this renderer does NOT draw, and why
 *
 * There is no map. `MapPreview` — 2,200 lines that project, tile and decorate
 * their own surface — has no React Native build, and porting it is its own
 * change with its own consumers. What that costs is smaller than it sounds,
 * because the web half already calls this list "the accessible representation,
 * not a sidebar": every fact a pin carries — who, how recently, how precisely,
 * what they are carrying — is on a row, in an order the map cannot express. So
 * a native board is the half a screen reader was always given, and a device
 * gets the same answers a dispatcher asks for. The gap is stated in
 * `NATIVE-NOTES.md` rather than claimed away, and it is where the map goes when
 * `MapPreview` is ported.
 *
 * The consequence for the API is one line in `FleetMap.types.native.ts`: the
 * native copy interface has no `map` and no `mapLabel`, because a caller should
 * not be asked to name controls nothing renders.
 */
export const FleetMap: React.FC<FleetMapProps> = React.memo(
  ({
    units,
    copy,
    // NO default. `undefined` is what tells the hook the caller does not own
    // the selection; defaulting it to `null` made every render look controlled
    // and the uncontrolled path unreachable.
    selectedId,
    onSelect,
    laggingAfterSeconds = FLEET_DEFAULT_LAGGING_AFTER_SECONDS,
    staleAfterSeconds = FLEET_DEFAULT_STALE_AFTER_SECONDS,
    loading = false,
    maxHeight,
    style,
    dataTestId,
  }) => {
    const theme = useUiTheme();
    const testId = dataTestId ?? 'fleet-map';
    const { ordered, active, select, onKeyDown } = useFleetMap(units, selectedId, onSelect);

    return (
      <View
        {...webRole('region')}
        accessibilityLabel={copy.title}
        testID={testId}
        style={[styles.panel, { gap: theme.spacing(FLEET_PANEL.gapUnits) }, style]}
      >
        <Text
          {...webRole('heading')}
          {...webAria({ 'aria-level': 2 })}
          testID={`${testId}-title`}
          style={[
            muiTypeStyle(theme, 'body1'),
            { color: theme.palette.text.primary, fontWeight: `${MUI_FONT_WEIGHT_MEDIUM}` },
          ]}
        >
          {copy.title}
        </Text>

        <FleetStatus announcement={copy.loading} loading={loading} testId={testId} />

        {!loading && ordered.length === 0 ? (
          <EmptyState
            variant="minimal"
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            dataTestId={`${testId}-empty`}
          />
        ) : (
          /* The busy marker belongs on the BODY and never on the panel root —
             the live region announcing the reload is a sibling above, and a
             live region inside a busy subtree is exactly what busy tells
             assistive technology to hold back. Marking the root would silence
             the announcement for the whole of the only window in which it has
             anything to say. The web half splits them the same way, and the
             wrapper is also what the shared loading stories address. */
          <View
            aria-busy={loading || undefined}
            accessibilityState={{ busy: loading }}
            testID={`${testId}-body`}
            style={styles.body}
          >
            <FleetRoster
              units={ordered}
              copy={copy}
              selectedId={active}
              onSelect={select}
              laggingAfterSeconds={laggingAfterSeconds}
              staleAfterSeconds={staleAfterSeconds}
              loading={loading}
              maxHeight={maxHeight}
              testId={testId}
              onKeyDown={onKeyDown}
            />
          </View>
        )}
      </View>
    );
  },
);

FleetMap.displayName = 'FleetMap';

const styles = StyleSheet.create({
  body: { flexShrink: 1, minWidth: 0 },
  panel: { flexDirection: 'column', minWidth: 0 },
  /**
   * Off screen but still in the tree, which is what a live region needs. A
   * `display: 'none'` view is not announced, and a zero-size one clips its text
   * on some readers.
   */
  srOnly: { height: 1, opacity: 0, overflow: 'hidden', position: 'absolute', width: 1 },
});

export default FleetMap;
