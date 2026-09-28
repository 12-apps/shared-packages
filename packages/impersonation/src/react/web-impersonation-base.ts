import type { ComponentType } from 'react';

import { bindImpersonationBanner, type ImpersonationBannerProps } from './banner';
import type { ImpersonationWebConfig, WebImpersonation } from './create-web-impersonation';
import { startImpersonation, type ImpersonationEndpoints } from './session-control';
import { httpImpersonationTransport } from './transport';

/**
 * The half of the web surface every host gets: the banner and `startPreview`.
 *
 * Its own module so the banner-only factory can be built from it with no edge,
 * static or dynamic, to the start dialog. `createWebImpersonation` reaches the
 * dialog through a dynamic import whatever its config says, and a bundler
 * does not read the `if` — so a storefront built from that factory carried the
 * operator's picker as a lazy chunk it could never open, and everything that
 * chunk shared with the eager path was split into chunks of its own.
 */
export function bindWebImpersonationBase(config: Omit<ImpersonationWebConfig, 'dialog'>): {
  endpoints: ImpersonationEndpoints;
  banner: ComponentType<ImpersonationBannerProps>;
  startPreview: WebImpersonation['startPreview'];
} {
  const endpoints: ImpersonationEndpoints = {
    transport: config.transport ?? httpImpersonationTransport(),
    platformPath: config.platformPath,
    tenantPath: config.tenantPath,
    onEnd: config.onEnd,
  };

  const banner = bindImpersonationBanner({
    endpoints,
    labels: config.labels.banner,
    onSessionChange: config.onSessionChange,
  });

  const startPreview: WebImpersonation['startPreview'] = (request) =>
    startImpersonation(endpoints, {
      path: config.tenantPath(request.tenantSlug),
      body: request.previewOf,
    });

  return { endpoints, banner, startPreview };
}
