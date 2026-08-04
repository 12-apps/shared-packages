import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type React from 'react';

import type { UploadButtonProps, UploadButtonState } from './UploadButton.types';

/** The props {@link useUploadButton} reads — the component's own props. */
type UploadButtonHookProps = UploadButtonProps;

/** Percent the simulated progress creeps to while waiting on `onUpload`. */
const SIMULATED_PROGRESS_CEILING = 90;
const SIMULATED_PROGRESS_STEP = 10;
const SIMULATED_PROGRESS_INTERVAL_MS = 100;
const PROGRESS_RESET_DELAY_MS = 1000;
const BYTES_PER_MB = 1024 * 1024;

const INITIAL_STATE: UploadButtonState = {
  isDragOver: false,
  isUploading: false,
  uploadProgress: 0,
  error: null,
};

/** Narrowed `setState` for the pieces below. */
type SetState = React.Dispatch<React.SetStateAction<UploadButtonState>>;

/** The size/custom validation applied to every file, in both modes. */
function useFileValidator(
  maxSizeMB: number | undefined,
  validate: ((file: globalThis.File) => string | null) | undefined,
): (file: globalThis.File) => string | null {
  return useCallback(
    (file: globalThis.File): string | null => {
      if (maxSizeMB && file.size > maxSizeMB * BYTES_PER_MB) {
        return `File size must be less than ${maxSizeMB}MB`;
      }
      return validate ? validate(file) : null;
    },
    [maxSizeMB, validate],
  );
}

/**
 * The built-in upload path, reachable from BOTH selection modes.
 *
 * Kept apart from selection because it is the only asynchronous part: left
 * inline it was single-file only, which made `onUpload` a silent no-op for a
 * multi-file caller — the worst kind of contract, since nothing fails.
 */
function useUploadRunner(
  onUpload: ((file: globalThis.File) => Promise<void>) | undefined,
  externalUploading: boolean,
  setState: SetState,
): (file: globalThis.File) => Promise<void> {
  return useCallback(
    async (file: globalThis.File) => {
      if (!onUpload || externalUploading) return;
      try {
        setState((prev) => ({ ...prev, isUploading: true, uploadProgress: 0 }));
        // The real percentage is unknowable through a bare promise, so the bar
        // creeps to a ceiling and only completes when the promise does.
        const timer = globalThis.setInterval(() => {
          setState((prev) => {
            if (prev.uploadProgress >= SIMULATED_PROGRESS_CEILING) {
              globalThis.clearInterval(timer);
              return prev;
            }
            return { ...prev, uploadProgress: prev.uploadProgress + SIMULATED_PROGRESS_STEP };
          });
        }, SIMULATED_PROGRESS_INTERVAL_MS);

        await onUpload(file);

        globalThis.clearInterval(timer);
        setState((prev) => ({ ...prev, isUploading: false, uploadProgress: 100 }));
        globalThis.setTimeout(() => {
          setState((prev) => ({ ...prev, uploadProgress: 0 }));
        }, PROGRESS_RESET_DELAY_MS);
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isUploading: false,
          uploadProgress: 0,
          error: error instanceof Error ? error.message : 'Upload failed',
        }));
      }
    },
    [onUpload, externalUploading, setState],
  );
}

/**
 * What {@link useUploadSelection} hands back. Module-private: the published
 * surface is {@link useUploadButton}, not the shape of its internals.
 */
interface UploadSelection {
  state: UploadButtonState;
  setDragOver: (isDragOver: boolean) => void;
  /** Route a picked/dropped selection through validation and the callbacks. */
  handleFiles: (files: globalThis.File[]) => void;
}

interface UploadSelectionOptions {
  onSelect: (file: globalThis.File) => void;
  multiple: boolean;
  onSelectMany?: (files: globalThis.File[]) => void;
  onUpload?: (file: globalThis.File) => Promise<void>;
  externalUploading: boolean;
  validateFile: (file: globalThis.File) => string | null;
}

/**
 * Selection, validation and the optional built-in upload.
 *
 * The rendering layer only reads `state` and calls `handleFiles`; every rule
 * about what a selection means lives here.
 */
function useUploadSelection({
  onSelect,
  multiple,
  onSelectMany,
  onUpload,
  externalUploading,
  validateFile,
}: UploadSelectionOptions): UploadSelection {
  const [state, setState] = useState<UploadButtonState>(INITIAL_STATE);
  const runUpload = useUploadRunner(onUpload, externalUploading, setState);

  const selectOne = useCallback(
    (file: globalThis.File) => {
      const error = validateFile(file);
      setState((prev) => ({ ...prev, error }));
      if (error) return;
      onSelect(file);
      void runUpload(file);
    },
    [onSelect, runUpload, validateFile],
  );

  /**
   * Multi-file mode is deliberately forgiving: the valid files are handed over
   * and the first rejection is reported alongside them, so dropping a folder
   * that also contains a PDF imports the rest instead of refusing the lot.
   */
  const selectMany = useCallback(
    (files: globalThis.File[], accept: (files: globalThis.File[]) => void) => {
      const accepted: globalThis.File[] = [];
      let rejection: string | null = null;
      for (const file of files) {
        const error = validateFile(file);
        if (error) rejection ??= error;
        else accepted.push(file);
      }
      setState((prev) => ({ ...prev, error: rejection }));
      if (accepted.length === 0) return;
      accept(accepted);
      // `onUpload` applies here too, one file after another, so the prop means
      // the same thing in both modes. Sequential because the progress bar is a
      // single indicator — overlapping uploads would report nonsense.
      void (async () => {
        for (const file of accepted) await runUpload(file);
      })();
    },
    [runUpload, validateFile],
  );

  const handleFiles = useCallback(
    (files: globalThis.File[]) => {
      if (files.length === 0) return;
      if (multiple && onSelectMany) selectMany(files, onSelectMany);
      else selectOne(files[0] as globalThis.File);
    },
    [multiple, onSelectMany, selectMany, selectOne],
  );

  const setDragOver = useCallback((isDragOver: boolean) => {
    setState((prev) => ({ ...prev, isDragOver }));
  }, []);

  return useMemo(() => ({ state, setDragOver, handleFiles }), [state, setDragOver, handleFiles]);
}

/** Drag-and-drop wiring for the dropzone variant. */
export interface DragHandlers {
  onDragEnter: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
}

const swallow = (event: React.DragEvent): void => {
  event.preventDefault();
  event.stopPropagation();
};

function useDragHandlers(
  disabled: boolean,
  setDragOver: (isDragOver: boolean) => void,
  handleFiles: (files: globalThis.File[]) => void,
): DragHandlers {
  return {
    onDragEnter: (event) => {
      swallow(event);
      if (!disabled) setDragOver(true);
    },
    onDragLeave: (event) => {
      swallow(event);
      setDragOver(false);
    },
    onDragOver: swallow,
    onDrop: (event) => {
      swallow(event);
      setDragOver(false);
      if (!disabled) handleFiles(Array.from(event.dataTransfer.files));
    },
  };
}

/** Everything the component needs, assembled from its props in one call. */
interface UploadButtonKit {
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputId: string;
  state: UploadButtonState;
  drag: DragHandlers;
  derived: DerivedUploadState;
  openPicker: () => void;
  handleInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * The component's whole behaviour in one hook, so the render body stays a thin
 * piece of wiring rather than a place where rules accumulate.
 */
export function useUploadButton(props: UploadButtonHookProps): UploadButtonKit {
  const {
    onSelect,
    multiple = false,
    onSelectMany,
    onUpload,
    uploading: externalUploading = false,
    progress: externalProgress = 0,
    maxSizeMB,
    validate,
    helperText,
    errorText,
    disabled = false,
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `upload-button-${useId()}`;
  const validateFile = useFileValidator(maxSizeMB, validate);
  const { state, setDragOver, handleFiles } = useUploadSelection({
    onSelect,
    multiple,
    onSelectMany,
    onUpload,
    externalUploading,
    validateFile,
  });
  const drag = useDragHandlers(disabled, setDragOver, handleFiles);
  const derived = useDerivedUploadState({
    state,
    inputId,
    externalUploading,
    externalProgress,
    errorText,
    helperText,
  });

  const openPicker = useCallback(() => inputRef.current?.click(), []);
  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(Array.from(event.target.files ?? []));
      // Let the same file be picked twice in a row — without this the input
      // holds the old value and re-selecting it fires no change event.
      event.target.value = '';
    },
    [handleFiles],
  );

  return { inputRef, inputId, state, drag, derived, openPicker, handleInputChange };
}

/** The values the render derives from props + internal state. */
interface DerivedUploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
  helperId?: string;
  errorId?: string;
  describedBy?: string;
}

/**
 * Fold props and internal state into what the render actually shows. External
 * state wins whenever the caller drives it.
 */
function useDerivedUploadState({
  state,
  inputId,
  externalUploading,
  externalProgress,
  errorText,
  helperText,
}: {
  state: UploadButtonState;
  inputId: string;
  externalUploading: boolean;
  externalProgress: number;
  errorText?: string;
  helperText?: string;
}): DerivedUploadState {
  const error = errorText || state.error;
  const helperId = helperText ? `${inputId}-helper` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return {
    isUploading: externalUploading || state.isUploading,
    progress: externalUploading ? externalProgress : state.uploadProgress,
    error,
    helperId,
    errorId,
    describedBy: [helperId, errorId].filter(Boolean).join(' ') || undefined,
  };
}
