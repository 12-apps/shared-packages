import { useState, type JSX } from 'react';

import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';
import { createWebStorage } from '@12-apps/storage/react';

/**
 * The whole wiring a frontend host performs for @12-apps/storage (12-20).
 *
 * Everything the upload IS — the browser-side re-encode, the upfront refusals,
 * the single same-origin POST, the failure vocabulary, the picker and its
 * preview — lives inside the package. This file names where the API is mounted,
 * and that is the only part that is genuinely the host's.
 *
 * There is no `fetchImpl`, deliberately: the package's default is same-origin
 * `fetch`, Vite proxies `/api` to `harness/backend`, and so a pick below crosses
 * a real socket into the package's own Hono router, through its own local-disk
 * driver, onto a real file. That is what makes the round trip below a test of the
 * seam BETWEEN the two published halves rather than of either one alone — and the
 * seam is where a `{ data }` envelope, a key shape and a served content type can
 * disagree while both sides' own suites stay green.
 *
 * `maxBytes` matches what the harness backend mounts. It is only an early refusal
 * — the server is the authority — but the copy the browser shows is generated from
 * this number, so a mismatch would be a message naming a limit nothing applies.
 */
const { ImageField, limits } = createWebStorage({
  apiBase: '/api',
  maxBytes: 1024 * 1024,
});

export function StorageUploadsPage(): JSX.Element {
  const [imageKey, setImageKey] = useState<string | null>(null);
  return (
    <Stack spacing={2} data-testid="storage-page">
      <Text as="h2">Imagens da loja</Text>
      <Text as="p" data-testid="storage-limit">{`Limite: ${limits.maxBytesLabel}`}</Text>
      <ImageField
        value={imageKey}
        onChange={setImageKey}
        label="Foto do produto"
        helperText="A imagem é reduzida no navegador antes do envio."
      />
      {/*
        The saved key, and the object it names, rendered as the host would use
        them: a form folds `imageKey` into its payload, and display code resolves
        it through the driver. `/api/uploads/local/<key>` is that resolution for
        the local driver, which is what the `<img>` below loads — so the spec can
        prove a real byte round trip instead of a screenshot of a blob URL.
      */}
      {imageKey ? (
        <Stack spacing={1}>
          <Text as="p" data-testid="storage-saved-key">
            {imageKey}
          </Text>
          <img
            src={`/api/uploads/local/${imageKey}`}
            alt="Objeto armazenado"
            data-testid="storage-stored-object"
            width={80}
          />
        </Stack>
      ) : null}
    </Stack>
  );
}
