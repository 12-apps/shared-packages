import type { CardProps as MuiCardProps } from '@mui/material/Card/index.js';
import type React from 'react';

import type {
  CardActionsBaseProps,
  CardBaseProps,
  CardContentBaseProps,
  CardHeaderBaseProps,
  CardMediaBaseProps,
} from './Card.base';

export type {
  CardActionsAlignment,
  CardActionsBaseProps,
  CardBaseProps,
  CardBorderRadius,
  CardContentBaseProps,
  CardEntranceAnimation,
  CardHeaderBaseProps,
  CardMediaBaseProps,
  CardVariant,
} from './Card.base';

/** The web `Card`: the shared contract, plus everything MUI's own `Card` takes. */
export interface CardProps
  extends CardBaseProps,
    Omit<MuiCardProps, 'variant' | keyof CardBaseProps> {
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  onBlur?: React.FocusEventHandler<HTMLDivElement>;
}

export type CardHeaderProps = CardHeaderBaseProps;

export type CardContentProps = CardContentBaseProps;

export type CardActionsProps = CardActionsBaseProps;

/** `component` is the DOM element MUI renders the media as — web only. */
export interface CardMediaProps extends CardMediaBaseProps {
  component?: React.ElementType;
}
