import { describe } from 'vitest';

import { itAnswersAPointerLikeASurface } from '../../__tests__/pointer-states.helpers';
import { Banner } from '../Banner';

describe('Given a Banner, the surface a pointer can click', () => {
  itAnswersAPointerLikeASurface(() => <Banner title="Atenção" dismissLabel="Fechar" data-testid="surface" />);
});
