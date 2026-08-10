import type { SizeValue } from '../../../tokens/scales';
import type { ModalProps as MuiModalProps } from '@mui/material';
import type { ReactNode } from 'react';

export type ModalVariant = 'center' | 'top' | 'bottom' | 'glass';
export type ModalSize = SizeValue;

export interface ModalProps extends Omit<MuiModalProps, 'children'> {
  children: ReactNode;
  variant?: ModalVariant;
  size?: ModalSize;
  backdrop?: boolean;
  persistent?: boolean;
  glass?: boolean;
  gradient?: boolean;
  glow?: boolean;
  pulse?: boolean;
  borderRadius?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  onClose?: () => void;
  dataTestId?: string;
}

export interface ModalContentProps {
  children: ReactNode;
  padding?: number | string;
  dataTestId?: string;
}