import type { ReactNode } from 'react';

import type { UploadButtonCopy } from '../../../copy';

export interface UploadButtonProps {
  /**
   * What this control says beyond the host's own button label. REQUIRED: three
   * of the four are announcements only a screen reader ever receives, which is
   * how they stayed English through every language pass.
   */
  copy: UploadButtonCopy;
  /** Button variant style */
  variant?: 'default' | 'outline' | 'ghost' | 'dropzone';

  /** Button text label */
  label?: string;

  /** File type restrictions (e.g., "image/*,.pdf") */
  accept?: string;

  /** Mobile camera capture hint */
  capture?: 'user' | 'environment';

  /** Disable file selection */
  disabled?: boolean;

  /** File selection callback (required) */
  onSelect: (file: globalThis.File) => void;

  /** Accept more than one file per pick/drop. Pair with {@link onSelectMany}. */
  multiple?: boolean;

  /**
   * Batch selection callback. Called INSTEAD of `onSelect` when `multiple` is
   * set, with every file that passed validation.
   *
   * Rejected files don't block the rest: the first rejection is surfaced as the
   * component's error while the valid files are still handed over, so dropping
   * a folder that happens to contain a PDF imports the XMLs beside it.
   *
   * {@link UploadButtonProps.onUpload} still applies, running once per accepted
   * file in sequence.
   */
  onSelectMany?: (files: globalThis.File[]) => void;

  /** Optional built-in upload handler with progress */
  onUpload?: (file: globalThis.File) => Promise<void>;

  /** External upload state control */
  uploading?: boolean;

  /** Upload progress (0-100) */
  progress?: number;

  /** Maximum file size in MB */
  maxSizeMB?: number;

  /** Custom file validation function */
  validate?: (file: globalThis.File) => string | null;

  /** Helper text */
  helperText?: string;

  /** Error message */
  errorText?: string;

  /** Custom icon */
  icon?: ReactNode;

  /** Additional CSS classes */
  className?: string;

  /** Test identifier */
  'data-testid'?: string;
}

export interface UploadButtonState {
  isDragOver: boolean;
  isUploading: boolean;
  uploadProgress: number;
  error: string | null;
}
