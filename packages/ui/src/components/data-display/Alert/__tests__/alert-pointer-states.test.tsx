import { describe } from 'vitest';

import { itAnswersAPointerLikeASurface } from '../../__tests__/pointer-states.helpers';
import { Alert } from '../Alert';

describe('Given an Alert, the surface a pointer can click', () => {
  itAnswersAPointerLikeASurface(() => <Alert title="Atenção" data-testid="surface" />);
});
