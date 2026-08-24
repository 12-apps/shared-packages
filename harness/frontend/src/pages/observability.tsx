import { useState, type JSX } from 'react';

import {
  reportRouteCrash,
  reportWarning,
  setObservabilityContext,
} from '@12-apps/observability-frontend';
import { Button } from '@12-apps/ui/form/Button';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

/**
 * The three funnels `@12-apps/observability-frontend` attaches to, plus the two
 * reports a host calls by hand — each behind a button, from a real browser.
 *
 * **The package is started in `main.tsx`, not here.** It installs
 * `window.onerror` and `unhandledrejection` synchronously, before its config has
 * arrived, exactly so an error thrown in that window is still caught — so a
 * page-level mount would miss the errors it exists for. This page drives what
 * is already installed.
 *
 * ## Why a browser, when the package has a jsdom suite
 *
 * Every claim here is about the BUILT artefact and the real SDK:
 *
 * - **a real `window.onerror`.** jsdom dispatches a synthetic `ErrorEvent`; a
 *   browser produces one from an actual uncaught throw, which is the only way
 *   to know the listener is on the right target and reads the right field.
 * - **a real transport.** The SDK serialises an envelope and POSTs it. The
 *   backend harness stands up the endpoint a DSN points at, so what a suite
 *   asserts is the bytes that LEFT — not an argument to a spy.
 * - **`beforeSend` deciding both ways.** An event that was dropped and an
 *   event that was never produced are indistinguishable from inside the page.
 *   Only somewhere the events land can tell them apart.
 * - **the pre-init buffer.** The config arrives over the network, so the SDK
 *   starts late and everything thrown before it is buffered in memory and
 *   drained afterwards. That race is the package's own stated cost, and a
 *   sequential fake resolves it away.
 *
 * ## What a HOST cannot delegate, and this page therefore spells
 *
 * `reportRouteCrash` is called from the app's error boundary — the package
 * cannot install itself there, because a boundary is a component in the host's
 * own tree. The tag it sets is what tells the noise filter a chunk-load failure
 * that reached a boundary is REAL, having already survived the loader's silent
 * retry. The button below stands in for that boundary.
 */

/** Named so `main.tsx`'s `isStaleChunk` classifier recognises it, as a host's would. */
class HarnessChunkError extends Error {
  override name = 'HarnessChunkError';
}

/** The three funnels the package attaches to — nothing here calls it by name. */
function CrashButtons({ onAct }: { onAct: (note: string) => void }): JSX.Element {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
      <Button
        dataTestId="obs-throw-uncaught"
        onClick={() => {
          // Thrown out of a timeout, not out of the handler: a throw inside an
          // event handler is caught by React's own machinery and never reaches
          // `window.onerror`.
          setTimeout(() => {
            throw new Error('harness uncaught boom');
          }, 0);
          onAct('uncaught');
        }}
      >
        Erro não capturado
      </Button>

      <Button
        dataTestId="obs-reject"
        onClick={() => {
          void Promise.reject(new Error('harness rejected boom'));
          onAct('rejection');
        }}
      >
        Promessa rejeitada
      </Button>

      <Button
        dataTestId="obs-boundary"
        onClick={() => {
          onAct('boundary');
          reportRouteCrash(new Error('harness boundary boom'), '\n    at HarnessPage');
        }}
      >
        Falha de página
      </Button>
    </Stack>
  );
}

/** One report that is not a crash, and the three the noise filter must drop. */
function NoiseButtons({ onAct }: { onAct: (note: string) => void }): JSX.Element {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
      <Button
        dataTestId="obs-warning"
        onClick={() => {
          // The case a `console.warn` used to cover: an operation that FAILED,
          // was handled, and left the user on a working screen — so nothing
          // crashes, nothing reaches a boundary, and the only record was a line
          // nobody reads.
          onAct('warning');
          reportWarning('harness contact save failed', {
            orderId: 'ord-1',
            email: 'cliente@exemplo.com',
          });
        }}
      >
        Aviso sem quebra
      </Button>

      <Button
        dataTestId="obs-noise-resize"
        onClick={() => {
          setTimeout(() => {
            throw new Error('ResizeObserver loop completed with undelivered notifications.');
          }, 0);
          onAct('noise');
        }}
      >
        Ruído do navegador
      </Button>

      <Button
        dataTestId="obs-stale-chunk"
        onClick={() => {
          // Out of a global handler, NOT a boundary: the loader swallows the
          // first one and reloads, so this arrival is the recovery working and
          // must not become an issue.
          setTimeout(() => {
            throw new HarnessChunkError('Failed to fetch dynamically imported module');
          }, 0);
          onAct('stale-chunk');
        }}
      >
        Chunk morto
      </Button>

      <Button
        dataTestId="obs-ignorable"
        onClick={() => {
          setTimeout(() => {
            throw new Error('harness-400 EMPTY_CART');
          }, 0);
          onAct('ignorable');
        }}
      >
        Resposta 4xx
      </Button>
    </Stack>
  );
}

/** Who is reporting — two INDEPENDENT writers, which is the point. */
function ContextButtons({ onAct }: { onAct: (note: string) => void }): JSX.Element {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
      <Button
        dataTestId="obs-set-context"
        onClick={() => {
          // The narrow object, not a session: the e-mail and name on a user are
          // exactly the fields that must not travel.
          onAct('context');
          setObservabilityContext({ tenant: 'ferragens-norte', role: 'OWNER' });
        }}
      >
        Identificar a loja
      </Button>

      <Button
        dataTestId="obs-set-impersonation"
        onClick={() => {
          // A SECOND component writing a DIFFERENT key. Both would be `tenant`
          // if the package had one field, and the later write would erase the
          // earlier one in an order neither controls.
          onAct('impersonation');
          setObservabilityContext({ impersonating: true, impersonatedStore: 'padaria-sul' });
        }}
      >
        Entrar como outra loja
      </Button>
    </Stack>
  );
}

export function ObservabilityPage(): JSX.Element {
  const [note, setNote] = useState('');

  return (
    <Stack spacing={2} data-testid="observability-page">
      <Text variant="heading" as="h2" size="md">
        Relato de erros do navegador
      </Text>
      <CrashButtons onAct={setNote} />
      <NoiseButtons onAct={setNote} />
      <ContextButtons onAct={setNote} />
      <Text variant="body" as="p" data-testid="obs-last-action">
        {note}
      </Text>
    </Stack>
  );
}
