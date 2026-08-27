import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Input } from '@12-apps/ui/form/Input';
import { ToggleGroup } from '@12-apps/ui/form/ToggleGroup';
import { Box } from '@12-apps/ui/mui/Box';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import type { EmailPreviewCoverage, EmailPreviewDetail, EmailPreviewIndex } from '../server/catalog';

import type { EmailPreviewScreenCopy } from './copy';
import { MessageList, matchesFilter } from './message-list';
import { MessageView, type PreviewTab, type PreviewWidth } from './message-view';
import { fetchEmailPreview, fetchEmailPreviewIndex } from './transport';

/**
 * The operator screen over `@12-apps/email/server`'s catalogue.
 *
 * ## What a host supplies, and what it does not
 *
 * `apiBase` — where the routes are mounted — and `copy`, by name. Nothing else:
 * the owners, the languages, the messages and their subjects all arrive from
 * the surface, because they are facts about the host's own mail that no prop
 * could usefully restate.
 *
 * ## The selection lives in the URL, without a router
 *
 * `?id=` and `?locale=`, read and written through `history.replaceState`. A
 * link to one mail in one language is the actual workflow this screen serves —
 * "look at what the reset mail says now" — and local state would make every
 * such conversation a set of instructions instead of a link.
 *
 * Deliberately NOT a router integration: this package cannot know whether a
 * host runs react-router, TanStack Router or a framework's own, and a screen
 * that imported one would be unmountable in the other two. `replaceState` is
 * the one API all of them are built on, and `replace` rather than `push` so
 * browsing twenty mails is not twenty back-button steps.
 */

export interface EmailPreviewScreenConfig {
  /** Where the routes are mounted, e.g. `/api/platform/email-previews`. */
  readonly apiBase: string;
  /** The screen's words. REQUIRED — see `./copy`. */
  readonly copy: EmailPreviewScreenCopy;
}

/** Read one search param without assuming a router owns the URL. */
function searchParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

function patchSearch(patch: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  const next = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) next.set(key, value);
  window.history.replaceState({}, '', `${window.location.pathname}?${next.toString()}`);
}

/** The surface's honest report about what it cannot show. */
function CoverageNotice({
  coverage,
  copy,
}: {
  coverage: EmailPreviewCoverage;
  copy: EmailPreviewScreenCopy;
}): JSX.Element | null {
  if (coverage.missing.length === 0 && coverage.orphan.length === 0) return null;
  return (
    <Alert severity="warning" data-testid="email-preview-coverage">
      <Text as="p" size="sm" weight="medium">
        {copy.coverageTitle}
      </Text>
      {coverage.missing.length > 0 ? (
        <Text as="p" size="sm">
          {copy.missingSamples(coverage.missing.join(', '))}
        </Text>
      ) : null}
      {coverage.orphan.length > 0 ? (
        <Text as="p" size="sm">
          {copy.orphanSamples(coverage.orphan.join(', '))}
        </Text>
      ) : null}
    </Alert>
  );
}

/** A load that can fail, in the two states a screen has to render. */
interface Loadable<T> {
  data: T | null;
  error: string | null;
}

function useLoadable<T>(load: () => Promise<T>): Loadable<T> & { reload: () => void } {
  const [state, setState] = useState<Loadable<T>>({ data: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ data: null, error: null });
    load()
      .then((data) => live && setState({ data, error: null }))
      .catch(
        (error: unknown) =>
          live &&
          setState({ data: null, error: error instanceof Error ? error.message : String(error) }),
      );
    return () => {
      // A language switched twice in a second must not let the FIRST answer
      // land last — the screen would show a document the operator did not ask
      // for, with the toggle disagreeing.
      live = false;
    };
  }, [load, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

function Failure({
  message,
  copy,
  onRetry,
}: {
  message: string;
  copy: EmailPreviewScreenCopy;
  onRetry: () => void;
}): JSX.Element {
  return (
    <Box data-testid="email-preview-error" sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
      <Alert severity="error">
        <Text as="p" size="sm">{copy.loadError}</Text>
        <Text as="p" size="sm">{message}</Text>
      </Alert>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {copy.retry}
      </Button>
    </Box>
  );
}

/** The right-hand pane: the selected message, or an invitation to pick one. */
function PreviewPane({
  apiBase,
  id,
  locale,
  copy,
  tab,
  width,
  onTabChange,
  onWidthChange,
}: {
  apiBase: string;
  id: string | null;
  locale: string;
  copy: EmailPreviewScreenCopy;
  tab: PreviewTab;
  width: PreviewWidth;
  onTabChange: (tab: PreviewTab) => void;
  onWidthChange: (width: PreviewWidth) => void;
}): JSX.Element {
  const load = useCallback(
    () =>
      id === null
        ? Promise.resolve(null as EmailPreviewDetail | null)
        : fetchEmailPreview(apiBase, id, locale),
    [apiBase, id, locale],
  );
  const detail = useLoadable(load);

  if (id === null) {
    return (
      <Text as="p" size="sm" color="secondary" data-testid="email-preview-empty">
        {copy.pickOne}
      </Text>
    );
  }
  if (detail.error !== null) {
    return <Failure message={detail.error} copy={copy} onRetry={detail.reload} />;
  }
  if (detail.data === null) {
    return (
      <Text as="p" size="sm" color="secondary" data-testid="email-preview-detail-loading">
        {copy.loading}
      </Text>
    );
  }
  return (
    <MessageView
      detail={detail.data}
      copy={copy}
      tab={tab}
      width={width}
      onTabChange={onTabChange}
      onWidthChange={onWidthChange}
    />
  );
}

/** The left column: the filter, and the rows under their owners. */
function CatalogueColumn({
  index,
  copy,
  selectedId,
  onSelect,
}: {
  index: EmailPreviewIndex;
  copy: EmailPreviewScreenCopy;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const visible = useMemo(
    () => index.items.filter((row) => matchesFilter(row, filter)),
    [index.items, filter],
  );
  return (
    /*
      The list owns its OWN scroll rather than growing the page.

      A host's console is typically a fixed-viewport shell whose centre column
      scrolls, and a twenty-mail catalogue then scrolls the preview frame off
      the screen — the two things this screen exists to show side by side
      cannot both be on it. `sticky` keeps the list put while the frame is
      read; the height is the viewport minus the chrome above it, so the column
      ends where the window does rather than at an arbitrary pixel count.
    */
    <Box
      sx={{
        width: 320,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        position: 'sticky',
        top: 0,
        maxHeight: 'calc(100dvh - 220px)',
        minHeight: 240,
      }}
    >
      <Input
        label={copy.searchLabel}
        placeholder={copy.searchPlaceholder}
        value={filter}
        data-testid="email-preview-filter"
        onChange={(event) => setFilter(event.target.value)}
        fullWidth
      />
      {/* Only the ROWS scroll — the filter field stays reachable. */}
      <Box sx={{ overflowY: 'auto', flex: 1, pr: 0.5 }}>
        <MessageList rows={visible} selectedId={selectedId} copy={copy} onSelect={onSelect} />
      </Box>
    </Box>
  );
}

/** The catalogue and the preview, once the index has loaded. */
function Browser({
  apiBase,
  index,
  copy,
  locale,
  selectedId,
  onPatch,
}: {
  apiBase: string;
  index: EmailPreviewIndex;
  copy: EmailPreviewScreenCopy;
  locale: string;
  selectedId: string | null;
  onPatch: (patch: Record<string, string>) => void;
}): JSX.Element {
  const [tab, setTab] = useState<PreviewTab>('html');
  const [width, setWidth] = useState<PreviewWidth>('desktop');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <CoverageNotice coverage={index.coverage} copy={copy} />
      <ToggleGroup
        dataTestId="email-preview-locale"
        exclusive
        value={locale}
        size="sm"
        options={index.locales.map((tag) => ({ value: tag, label: tag }))}
        onChange={(_event, value) => {
          if (value) onPatch({ locale: String(value) });
        }}
      />
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <CatalogueColumn
          index={index}
          copy={copy}
          selectedId={selectedId}
          onSelect={(id) => onPatch({ id })}
        />
        <Box sx={{ flex: 1, minWidth: 360 }}>
          <PreviewPane
            apiBase={apiBase}
            id={selectedId}
            locale={locale}
            copy={copy}
            tab={tab}
            width={width}
            onTabChange={setTab}
            onWidthChange={setWidth}
          />
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Build the screen. One call, one config object — the shape every factory in
 * this estate has.
 */
export function createEmailPreviewScreen(config: EmailPreviewScreenConfig): {
  page: () => JSX.Element;
} {
  const { apiBase, copy } = config;

  function EmailPreviewsPage(): JSX.Element {
    const [urlNonce, setUrlNonce] = useState(0);
    const locale = searchParam('locale') ?? '';
    const selectedId = searchParam('id');
    // `urlNonce` is a dependency of the CALLBACK rather than of the effect: a
    // URL patched in place changes neither `apiBase` nor `locale` by identity,
    // so without it the list would keep the answer it already had.
    const load = useCallback(
      () => fetchEmailPreviewIndex(apiBase, locale),
      [locale, urlNonce],
    );
    const index = useLoadable(load);

    const patch = (next: Record<string, string>): void => {
      patchSearch(next);
      // `replaceState` does not notify React, so the screen re-reads the URL
      // through this counter rather than through a router's own subscription.
      setUrlNonce((n) => n + 1);
    };

    return (
      <Box data-testid="page-email-previews" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Heading level="h2">{copy.title}</Heading>
          <Text as="p" size="sm" color="secondary">
            {copy.description}
          </Text>
        </Box>
        {index.error !== null ? (
          <Failure message={index.error} copy={copy} onRetry={index.reload} />
        ) : null}
        {index.error === null && index.data === null ? (
          <Text as="p" size="sm" color="secondary" data-testid="email-preview-index-loading">
            {copy.loading}
          </Text>
        ) : null}
        {index.data !== null ? (
          <Browser
            apiBase={apiBase}
            index={index.data}
            copy={copy}
            locale={index.data.locale}
            selectedId={selectedId}
            onPatch={patch}
          />
        ) : null}
      </Box>
    );
  }

  return { page: EmailPreviewsPage };
}
