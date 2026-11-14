'use client';

import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { useMemo, useState, type JSX } from 'react';

import { createConfirmedAct, problemOf, type ConfirmedActAnswer, type ConfirmedActProblem } from './confirmed-act';
import type { ActConfirmCopy } from './copy';

/**
 * The reason and the PIN that confirm a dangerous act on captured money, and
 * the act sent AT ONCE on confirm — no undo window (owner decision T2 on
 * FUT-4996). The host sends it (`onSend`) through its own permission and PIN
 * gate, and answers ok or its refusal code, which is said here.
 */
export interface ActConfirmProps {
  /** What is being confirmed, as the host words it (the act's own button label). */
  readonly title: string;
  readonly copy: ActConfirmCopy;
  readonly onSend: (input: { reason: string; pin: string }) => Promise<ConfirmedActAnswer>;
  readonly onDone: () => void;
  readonly onBack: () => void;
  readonly dataTestId?: string;
}

type Shown = ConfirmedActProblem | { readonly code: string } | null;

function messageOf(shown: Shown, copy: ActConfirmCopy): string | null {
  if (shown === null) return null;
  if (shown === 'reason') return copy.reasonShort;
  if (shown === 'pin') return copy.pinMissing;
  return copy.refused[shown.code] ?? copy.refused.fallback;
}

export function ActConfirm({ title, copy, onSend, onDone, onBack, dataTestId = 'terminal-act' }: ActConfirmProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [shown, setShown] = useState<Shown>(null);
  const [sending, setSending] = useState(false);
  const act = useMemo(() => createConfirmedAct<'act'>({ send: ({ reason: why, pin: secret }) => onSend({ reason: why, pin: secret }) }), [onSend]);

  const confirm = async (): Promise<void> => {
    const problem = problemOf(reason, pin);
    if (problem !== null) return setShown(problem);
    setSending(true);
    try {
      const answer = await act.confirm({ act: 'act', reason, pin });
      if (answer.ok) return onDone();
      setShown('problem' in answer ? answer.problem : { code: answer.code });
    } catch {
      setShown({ code: 'fallback' });
    } finally {
      setSending(false);
    }
  };

  const message = messageOf(shown, copy);
  return (
    <Stack spacing={1.5} data-testid={dataTestId}>
      <Box component="p" sx={{ m: 0, fontWeight: 700 }}>
        {title}
      </Box>
      <TextField
        label={copy.reasonLabel}
        helperText={copy.reasonHint}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        inputProps={{ 'data-testid': `${dataTestId}-reason`, maxLength: 200 }}
        size="small"
        fullWidth
      />
      <TextField
        label={copy.pinLabel}
        type="password"
        value={pin}
        onChange={(event) => setPin(event.target.value)}
        inputProps={{ 'data-testid': `${dataTestId}-pin`, inputMode: 'numeric', autoComplete: 'off' }}
        size="small"
        fullWidth
      />
      {message === null ? null : (
        <Alert severity="warning" data-testid={`${dataTestId}-problem`}>
          {message}
        </Alert>
      )}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={() => void confirm()} disabled={sending} data-testid={`${dataTestId}-confirm`}>
          {copy.confirm}
        </Button>
        <Button variant="outlined" onClick={onBack} disabled={sending} data-testid={`${dataTestId}-back`}>
          {copy.back}
        </Button>
      </Stack>
    </Stack>
  );
}
