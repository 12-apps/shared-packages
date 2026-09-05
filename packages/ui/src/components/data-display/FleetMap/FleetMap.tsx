import Box from '@mui/material/Box/index.js';
import Typography from '@mui/material/Typography/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { EmptyState } from '../EmptyState/EmptyState';

import { FleetBody } from './FleetBody';
import { useFleetMap } from './FleetMap.hooks';
import type { FleetMapProps } from './FleetMap.types';

/**
 * How long a fix stays `live`, and then `lagging`, when the caller says nothing.
 *
 * Ninety seconds and five minutes: sized for a phone reporting every twenty
 * seconds, which is the densest cadence a battery tolerates all day. They are
 * DEFAULTS and not a rule — a fleet on five-minute trackers passes its own, and
 * the props exist so it can.
 */
const DEFAULT_LAGGING_AFTER_SECONDS = 90;
const DEFAULT_STALE_AFTER_SECONDS = 300;

/** The map's own default height. Overridable, and never a hardcoded viewport. */
const DEFAULT_HEIGHT = '420px';

/**
 * FleetMap — where a set of tracked units is right now, as a map beside the
 * roster that reads it.
 *
 * Product-free by construction: it draws labelled dots with a freshness, and
 * every word — the heading, the three freshness states, how a duration and a
 * distance are written — arrives through {@link FleetMapProps.copy}. Couriers,
 * service vans and field engineers are all the same picture.
 *
 * ## Three decisions worth knowing before changing it
 *
 * **The roster is the accessible representation, not a sidebar.** A map is a
 * picture and a screen reader cannot read one, so the list carries the
 * information: everything a sighted user gets from a pin — who, how recently,
 * what they are carrying — is on the row. The map is a NAMED region rather than
 * an `aria-hidden` one, because its controls are focusable and hiding a
 * focusable subtree is the `aria-hidden-focus` violation.
 *
 * **Nothing here formats.** `lastSeen` and `accuracy` are functions on the copy
 * object, the same line `StatCard` holds for its `value`: a duration and a
 * distance are locale rules, and a component that wrote "2 min ago" would have
 * made English the only language it could ever render.
 *
 * **An empty fleet is an empty STATE, not an empty map.** A map with no pins is
 * indistinguishable from a map that failed to load, and the difference is the
 * whole question a dispatcher is asking.
 */
export const FleetMap: React.FC<FleetMapProps> = React.memo(
  ({
    units,
    copy,
    selectedId = null,
    onSelect,
    laggingAfterSeconds = DEFAULT_LAGGING_AFTER_SECONDS,
    staleAfterSeconds = DEFAULT_STALE_AFTER_SECONDS,
    height = DEFAULT_HEIGHT,
    loading = false,
    googleMapsApiKey,
    className,
    dataTestId,
  }) => {
    const theme = useTheme();
    const testId = dataTestId || 'fleet-map';
    const headingId = React.useId();
    const { ordered, centre, select, markers, onKeyDown } = useFleetMap(units, selectedId, onSelect);

    return (
      <Box
        role="region"
        aria-labelledby={headingId}
        aria-busy={loading || undefined}
        className={className}
        data-testid={testId}
        sx={{ display: 'flex', flexDirection: 'column', gap: theme.spacing(1.5), minWidth: 0 }}
      >
        <Typography
          id={headingId}
          variant="subtitle1"
          component="h2"
          data-testid={`${testId}-title`}
          sx={{ fontWeight: theme.typography.fontWeightMedium }}
        >
          {copy.title}
        </Typography>

        {!loading && ordered.length === 0 ? (
          <EmptyState
            variant="minimal"
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            dataTestId={`${testId}-empty`}
          />
        ) : (
          <FleetBody
            ordered={ordered}
            centre={centre}
            markers={markers}
            select={select}
            onKeyDown={onKeyDown}
            copy={copy}
            selectedId={selectedId}
            laggingAfterSeconds={laggingAfterSeconds}
            staleAfterSeconds={staleAfterSeconds}
            height={height}
            loading={loading}
            googleMapsApiKey={googleMapsApiKey}
            testId={testId}
          />
        )}
      </Box>
    );
  },
);

FleetMap.displayName = 'FleetMap';

export default FleetMap;
