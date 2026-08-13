import { useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';

import type { DraftWire, LifecycleApiClient } from './api';
import { DATE_TIME } from './labels';

/**
 * The unpublished-draft banner (12-17), ported from future-pay's
 * `product-draft-banner` and generalized to any registered collection: when
 * the tenant has drafts on and the item carries an open draft, offers
 * "Carregar rascunho" (the host prefills its form), "Publicar" and
 * "Descartar". The draft `data` payload is the same body the host's save
 * endpoints accept, so the prefill is a straight remap.
 *
 * `testIdPrefix` keeps the future-pay ids portable: the product editor passes
 * `product-draft` and its specs keep matching `product-draft-banner`,
 * `product-draft-publish`, … verbatim.
 */

export interface DraftBannerProps {
  /** The registration's URL slug ("products") — where publish/discard live. */
  slug: string;
  draft: DraftWire;
  /** Prefill the form with the draft body. */
  onLoad: (draft: DraftWire) => void;
  /** The draft was published; `applied: false` means parked for approval. */
  onPublished: (applied: boolean) => void;
  onDiscarded: () => void;
  /** Test-id namespace; future-pay's product editor passes `product-draft`. */
  testIdPrefix?: string;
  /** The notice, when the generic copy is wrong for the collection
   * (future-pay's product editor says "Este produto tem…"). */
  title?: string;
}

interface BannerActions {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  publish: () => Promise<void>;
  discard: () => Promise<void>;
}

/** Publish/discard dispatch state for the banner. */
function useDraftBannerActions(api: LifecycleApiClient, props: DraftBannerProps): BannerActions {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.publishDraft(props.slug, props.draft.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      props.onPublished(result.data.applied);
    } finally {
      setBusy(false);
    }
  }

  async function discard(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api.discardDraft(props.slug, props.draft.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      props.onDiscarded();
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, clearError: () => setError(null), publish, discard };
}

/** The banner itself: notice + the load / publish / discard actions. */
export function DraftBanner({
  api,
  ...props
}: DraftBannerProps & { api: LifecycleApiClient }): JSX.Element {
  const { draft, onLoad, testIdPrefix = 'draft' } = props;
  const actions = useDraftBannerActions(api, props);

  return (
    <Box data-testid={`${testIdPrefix}-banner`} sx={{ mb: 2 }}>
      <Alert
        variant="info"
        title={props.title ?? 'Este item tem um rascunho não publicado.'}
        description={`Atualizado em ${DATE_TIME.format(new Date(draft.updatedAt))}.`}
        data-testid={`${testIdPrefix}-banner-alert`}
      />
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button
          variant="outline"
          size="sm"
          disabled={actions.busy}
          onClick={() => onLoad(draft)}
          dataTestId={`${testIdPrefix}-load`}
        >
          Carregar rascunho
        </Button>
        <Button
          size="sm"
          loading={actions.busy}
          onClick={() => void actions.publish()}
          dataTestId={`${testIdPrefix}-publish`}
        >
          Publicar
        </Button>
        <Button
          variant="text"
          color="danger"
          size="sm"
          disabled={actions.busy}
          onClick={() => void actions.discard()}
          dataTestId={`${testIdPrefix}-discard`}
        >
          Descartar
        </Button>
      </Stack>
      {actions.error && (
        <Alert
          variant="danger"
          description={actions.error}
          closable
          onClose={actions.clearError}
          data-testid={`${testIdPrefix}-error`}
        />
      )}
    </Box>
  );
}
