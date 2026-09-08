import { describe } from 'vitest';

import { itAnswersAPointerLikeASurface } from '../../__tests__/pointer-states.helpers';
import { Alert } from '../Alert';
import type { AlertVariant } from '../Alert.base';

const VARIANTS: readonly AlertVariant[] = ['info', 'success', 'warning', 'danger', 'glass', 'gradient'];

describe('Given an Alert, the surface a pointer can click', () => {
  itAnswersAPointerLikeASurface(VARIANTS, (variant) => (
    <Alert variant={variant as AlertVariant} title="Atenção" data-testid="surface" />
  ));
});
