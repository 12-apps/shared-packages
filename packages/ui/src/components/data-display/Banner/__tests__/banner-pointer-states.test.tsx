import { describe } from 'vitest';

import { itAnswersAPointerLikeASurface } from '../../__tests__/pointer-states.helpers';
import { Banner } from '../Banner';
import type { BannerVariant } from '../Banner.types';

const VARIANTS: readonly BannerVariant[] = ['info', 'success', 'warning', 'critical'];

describe('Given a Banner, the surface a pointer can click', () => {
  itAnswersAPointerLikeASurface(VARIANTS, (variant) => (
    <Banner
      variant={variant as BannerVariant}
      title="Atenção"
      dismissLabel="Fechar"
      data-testid="surface"
    />
  ));
});
