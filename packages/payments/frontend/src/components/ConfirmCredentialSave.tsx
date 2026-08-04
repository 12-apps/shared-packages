'use client';

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

import type { CredentialFieldSpec } from '@12-apps/payments-backend';

/**
 * The last look at the value that decides who gets paid.
 *
 * Two real R$ 1,01 payments were lost during this flow's development, both to
 * things that could be tested and fixed. A mistyped InfiniteTag is the failure
 * with no such recourse: the charge succeeds, the link works, the buyer is
 * happy, and the money is in a stranger's account with nothing on our side able
 * to reverse it. There is no checksum to catch it, no confirmation email, and
 * the store finds out at the end of the month.
 *
 * So the one intervention available is to show the value back, large, in the
 * face it will be read in, and say what saving it means — after the owner has
 * decided to save and before the write happens. This is the whole of the
 * dialog: no new information, one more reading.
 */

export interface PendingSave {
  spec: CredentialFieldSpec;
  value: string;
}

export function ConfirmCredentialSave({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  /** Null while nothing is awaiting confirmation. */
  pending: PendingSave | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={pending !== null}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      data-testid="payments-confirm-credential"
      aria-labelledby="payments-confirm-credential-title"
    >
      <DialogTitle id="payments-confirm-credential-title">
        Confirme para onde vai o dinheiro
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          Todo pagamento recebido por esta loja será depositado na conta desta{' '}
          {pending?.spec.label ?? 'credencial'}:
        </Typography>
        <Box
          data-testid="payments-confirm-credential-value"
          sx={{
            my: 2,
            py: 2,
            px: 1,
            textAlign: 'center',
            fontFamily: 'monospace',
            fontSize: '1.5rem',
            letterSpacing: '0.12em',
            wordBreak: 'break-all',
            borderRadius: 1,
            bgcolor: 'action.hover',
          }}
        >
          {pending?.value}
        </Box>
        <Typography variant="caption" color="text.secondary">
          Um valor errado envia os pagamentos desta loja para outra pessoa, e não há como reverter.
        </Typography>
      </DialogContent>
      <DialogActions>
        {/*
          Cancel is the wide, plain, first-reached option and confirm carries
          the specific verb: an owner who is not sure should find it easier to
          go back and check than to press on.
        */}
        <Button onClick={onCancel} disabled={busy} data-testid="payments-confirm-credential-cancel">
          Voltar e revisar
        </Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={busy}
          data-testid="payments-confirm-credential-confirm"
        >
          É essa, salvar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
