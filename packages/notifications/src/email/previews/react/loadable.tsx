import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { EmailPreviewScreenCopy } from './copy';

/**
 * The screen's async plumbing: one hook, and the state it cannot render itself.
 *
 * Its own module because it is the half with no opinion about e-mail. What is
 * left in `preview-screen.tsx` is composition — which columns, which panes,
 * what the URL says — and this is the machinery underneath all of it.
 *
 * `keepPrevious` is the load-bearing option and its docblock says why: a
 * consumer that renders children only while `data` is non-null gets those
 * children UNMOUNTED by a blanking reload, which silently discards whatever
 * state they held.
 */

/** A load that can fail, in the two states a screen has to render. */
interface Loadable<T> {
  data: T | null;
  error: string | null;
}

export function useLoadable<T>(
  load: () => Promise<T>,
  options: { keepPrevious?: boolean } = {},
): Loadable<T> & { reload: () => void } {
  const [state, setState] = useState<Loadable<T>>({ data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const { keepPrevious = false } = options;
  useEffect(() => {
    let live = true;
    // `keepPrevious` holds the last good answer on screen while the next one is
    // in flight, and it is not a nicety. The consumer of this hook renders its
    // children only while `data` is non-null, so blanking here UNMOUNTS them —
    // taking the filter text, the open tab and the chosen width with it. On a
    // fast connection the refetch lands before anyone notices; on a slow one
    // the operator watches what they just typed disappear.
    setState((previous) => (keepPrevious ? { ...previous, error: null } : { data: null, error: null }));
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

export function Failure({
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
