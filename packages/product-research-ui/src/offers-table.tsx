'use client';

/**
 * The full ranked comparison — cheapest unit price first (the server's rank,
 * locked as the default order). Fardo math is transparent: the unit-price
 * cell's tooltip spells out `total ÷ units`. Row link-outs open the store in
 * a new tab; everything else is plain data.
 */
import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { DataViewsCopyProvider, DataViewsGrid } from '@12-apps/ui/data-display/DataViews';
import type { DataViewColumn } from '@12-apps/ui/data-display/DataViews';
import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { availabilityLabel } from './best-offer-card';
import { formatCentsBRL } from './format';
import { resolveMessages, type ResearchMessages } from './messages';
import { OutsideAreaBadge } from './outside-area-badge';
import { ShippingUnknownBadge } from './shipping-unknown-badge';
import { SuspectUnitPriceBadge } from './suspect-unit-price-badge';
import type { OfferOutput } from './types';

export interface OffersTableProps {
  offers: OfferOutput[];
  /** Every string this screen renders — the HOST's words (see `./messages`). */
  messages: ResearchMessages;
}

interface OfferRow extends Record<string, unknown> {
  id: string;
  rank: number;
  supplierName: string;
  sourceType: string;
  title: string;
  url: string | null;
  packLabel: string;
  packMath: string;
  unitLabel: string;
  totalLabel: string;
  availability: string;
  relevanceLabel: string;
  /** FUT-491: this price is the store's default region's, not this CEP's. */
  outsideDeliveryArea: boolean;
  /** FUT-497: one unit claimed at a whole multipack's price — read with care. */
  suspectUnitPrice: boolean;
  /** FUT-518: the source stated no shipping cost, so the total is a minimum. */
  shippingUnknown: boolean;
}

function toRows(offers: OfferOutput[], t: ResearchMessages): OfferRow[] {
  return offers.map((offer, index) => {
    const unitLabel = formatCentsBRL(offer.unitPriceCents);
    return {
      id: offer.id,
      rank: offer.rank ?? index + 1,
      supplierName: offer.supplierName,
      sourceType: offer.sourceType,
      title: offer.title,
      url: offer.url,
      packLabel: t.packUnits(offer.packQuantity),
      packMath:
        offer.packQuantity > 1
          ? t.packMath(formatCentsBRL(offer.priceCents), offer.packQuantity, unitLabel)
          : unitLabel,
      unitLabel,
      totalLabel: formatCentsBRL(offer.totalCents),
      availability: availabilityLabel(offer.availability, t),
      relevanceLabel: t.relevance(Math.round(offer.relevanceScore * 100)),
      outsideDeliveryArea: offer.outsideDeliveryArea,
      suspectUnitPrice: offer.suspectUnitPrice === true,
      // `=== null` and not a falsy test: 0 is a REAL answer here ("the store
      // stated free shipping"), and treating it as unknown would re-create the
      // conflation FUT-518 removed, only in the other direction.
      shippingUnknown: offer.shippingCents === null,
    };
  });
}

/**
 * A cell that is "the value, plus a caveat when there is one". Every caveated
 * column wears the same shape — wrapping, aligned, and the badge AFTER the
 * number it qualifies — so a third caveat cannot drift from the first two.
 */
function CaveatCell({
  value,
  badge,
}: {
  value: JSX.Element;
  badge: JSX.Element | null;
}): JSX.Element {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      {value}
      {badge}
    </Stack>
  );
}

/** The plain body text every caveated cell puts beside its badge. */
function CellText({ children }: { children: string }): JSX.Element {
  return (
    <Text variant="body" as="span" size="sm">
      {children}
    </Text>
  );
}

/** One row plus the table's already-RESOLVED bundle — never re-resolved per row. */
interface CellProps {
  row: OfferRow;
  t: ResearchMessages;
}

/**
 * FUT-491: the out-of-area caveat sits with the STORE, because it is the
 * store's delivery area the price does not cover. Never hides the row.
 */
function SupplierCell({ row, t }: CellProps): JSX.Element {
  return (
    <CaveatCell
      value={<CellText>{row.supplierName}</CellText>}
      badge={
        row.outsideDeliveryArea ? (
          <OutsideAreaBadge t={t} dataTestId={`offer-outside-area-${row.id}`} />
        ) : null
      }
    />
  );
}

/**
 * The fardo math rides the native tooltip — hover explains the division.
 * FUT-497: the plausibility caveat sits with the per-unit NUMBER, which is the
 * figure it qualifies. Additive — the price still renders.
 */
function UnitPriceCell({ row, t }: CellProps): JSX.Element {
  return (
    <CaveatCell
      value={
        <span title={row.packMath}>
          <CellText>{row.unitLabel}</CellText>
        </span>
      }
      badge={
        row.suspectUnitPrice ? (
          <SuspectUnitPriceBadge t={t} dataTestId={`offer-suspect-unit-${row.id}`} />
        ) : null
      }
    />
  );
}

/**
 * FUT-518: the freight caveat sits with the TOTAL, because `totalCents` is the
 * only rendered number shipping enters — the per-unit price is `priceCents /
 * packQuantity` and never carries it. Additive: the total still renders, and
 * the row keeps its rank.
 */
function TotalCell({ row, t }: CellProps): JSX.Element {
  return (
    <CaveatCell
      value={<CellText>{row.totalLabel}</CellText>}
      badge={
        row.shippingUnknown ? (
          <ShippingUnknownBadge t={t} dataTestId={`offer-shipping-unknown-${row.id}`} />
        ) : null
      }
    />
  );
}

/** Explicitly off-platform: a plain anchor to the store, in a new tab. */
function LinkCell({ row, t }: CellProps): JSX.Element {
  if (row.url === null) {
    return (
      <Text variant="caption" as="span" color="secondary">
        —
      </Text>
    );
  }
  return (
    <a href={row.url} target="_blank" rel="noopener noreferrer" data-testid={`offer-link-${row.id}`}>
      {t.columnLink} ↗
    </a>
  );
}

function buildColumns(t: ResearchMessages): DataViewColumn<OfferRow>[] {
  return [
    { id: 'rank', header: t.columnRank, accessor: (row) => String(row.rank) },
    {
      id: 'supplier',
      header: t.columnSupplier,
      accessor: 'supplierName',
      searchable: true,
      cell: ({ row }) => <SupplierCell row={row} t={t} />,
    },
    {
      id: 'source',
      header: t.columnSource,
      accessor: 'sourceType',
      cell: ({ row }) => <Chip label={row.sourceType} size="sm" variant="outlined" />,
    },
    { id: 'title', header: t.columnProduct, accessor: 'title', searchable: true },
    { id: 'pack', header: t.columnPack, accessor: 'packLabel', enableSort: false },
    {
      id: 'unit',
      header: t.columnUnitPrice,
      accessor: 'unitLabel',
      enableSort: false,
      cell: ({ row }) => <UnitPriceCell row={row} t={t} />,
    },
    {
      id: 'total',
      header: t.columnTotal,
      accessor: 'totalLabel',
      enableSort: false,
      cell: ({ row }) => <TotalCell row={row} t={t} />,
    },
    { id: 'availability', header: t.columnAvailability, accessor: 'availability', enableSort: false },
    { id: 'relevance', header: t.columnRelevance, accessor: 'relevanceLabel', enableSort: false },
    {
      id: 'link',
      header: t.columnLink,
      accessor: (row) => (row.url === null ? '' : 'abrir'),
      enableSort: false,
      cell: ({ row }) => <LinkCell row={row} t={t} />,
    },
  ];
}

export function OffersTable({ offers, messages }: OffersTableProps): JSX.Element {
  const t = resolveMessages(messages);
  if (offers.length === 0) {
    return (
      // EmptyState forwards no test id — the wrapper carries it.
      <div data-testid="offers-empty">
        <EmptyState variant="minimal" title={t.offersEmptyTitle} description={t.offersEmptyBody} />
      </div>
    );
  }
  return (
    // The grid's own words come from this screen's copy: `@12-apps/ui` ships
    // none, and throws rather than falling back to one host's Portuguese.
    <DataViewsCopyProvider copy={t.dataViews}>
      <DataViewsGrid<OfferRow>
        rows={toRows(offers, t)}
        columns={buildColumns(t)}
        fields={[]}
        getRowId={(row) => row.id}
        dataTestId="offers-table"
        testIdPrefix="offers"
        emptyState={
          <Text variant="body" as="p">
            {t.offersEmptyTitle}
          </Text>
        }
      />
    </DataViewsCopyProvider>
  );
}
