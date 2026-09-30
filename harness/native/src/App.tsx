import { Screen } from '@12-apps/ui/layout/Screen';
import { UiProvider } from '@12-apps/ui/provider';
import * as React from 'react';

import { Gallery } from './Gallery';

/** Exercise the published screen boundary and every native component through Metro. */
export function App(): React.JSX.Element {
  return (
    <UiProvider theme={{ mode: 'light' }}>
      <Screen dataTestId="app-root" p={2} gap={3}>
        <Gallery />
      </Screen>
    </UiProvider>
  );
}
