import type { JSX } from 'react';

import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Button } from '@12-apps/ui/form/Button';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

/**
 * The confirm step every destructive write sits behind (12-13) — the packaged
 * counterpart of future-pay's shared row-confirm primitive (FUT-546): one
 * question, the consequence in plain words, and the destructive verb as the
 * primary action. Self-contained because the package cannot import the
 * host's dialog machinery.
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  return (
    <Dialog
      open={props.open}
      onClose={props.onCancel}
      title={props.title}
      size="sm"
      showCloseButton
      dataTestId="confirm-dialog"
    >
      <DialogContent>
        <Stack spacing={2}>
          <Text as="p">{props.body}</Text>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button
              variant="text"
              onClick={props.onCancel}
              disabled={props.busy}
              dataTestId="confirm-cancel"
            >
              Cancelar
            </Button>
            <Button
              onClick={props.onConfirm}
              disabled={props.busy}
              dataTestId="confirm-accept"
            >
              {props.confirmLabel}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
