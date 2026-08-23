'use client';

import {
  Alert,
  Box,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useCallback, useState } from 'react';

import type { MerchantSettingsView, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { usePaymentsSettingsCopy } from './settings-copy-context';
import { richText } from './rich-text';

/**
 * The store's failover chain, ordered.
 *
 * Checkout walks this list top-down, moving on only when it can PROVE the
 * provider above created no charge — so the order is real routing
 * configuration, not a display preference. That is why the copy names the
 * first entry explicitly rather than leaving the merchant to infer it from
 * position.
 *
 * Reordering is offered two ways on purpose. Dragging is what the design asks
 * for; the arrow buttons are what makes it usable with a keyboard or a screen
 * reader, and what an automated test can drive. Neither is a fallback for the
 * other — they write the same whole-chain update.
 */
export interface ProviderPriorityListProps {
  view: MerchantSettingsView;
  client: PaymentsSettingsClient;
  /** Called with the refreshed view after a successful reorder. */
  onReordered?: (view: MerchantSettingsView) => void;
}

/** Move `from` to `to`, returning a new array. */
function reorder(chain: readonly string[], from: number, to: number): string[] {
  if (to < 0 || to >= chain.length || from === to) return [...chain];
  const next = [...chain];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...chain];
  next.splice(to, 0, moved);
  return next;
}

function labelOf(providers: readonly ProviderDescriptor[], name: string): string {
  return providers.find((p) => p.name === name)?.displayName ?? name;
}

/**
 * The chain, derived from `configs` rather than read from `view.providerChain`.
 *
 * Both carry the same fact, and deriving keeps ONE source of truth in the UI:
 * a payload where the two disagree — a client bundle talking to an older
 * server mid-deploy, say — renders the enable flags the rest of this page
 * shows, instead of white-screening on a field that is not there.
 */
export function chainOf(view: MerchantSettingsView): string[] {
  return view.configs
    .filter((c) => c.enabled)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider))
    .map((c) => c.provider);
}

interface PriorityRowProps {
  label: string;
  provider: string;
  index: number;
  total: number;
  saving: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDropOn: () => void;
  onDragEnd: () => void;
  onMove: (from: number, to: number) => void;
}

function PriorityRow({
  label,
  provider,
  index,
  total,
  saving,
  dragging,
  onDragStart,
  onDropOn,
  onDragEnd,
  onMove,
}: PriorityRowProps) {
  const copy = usePaymentsSettingsCopy().priority;
  return (
    <Paper
      component="li"
      variant="outlined"
      data-testid={`payments-priority-item-${provider}`}
      draggable={!saving}
      onDragStart={onDragStart}
      onDragOver={(e: React.DragEvent) => e.preventDefault()}
      onDrop={(e: React.DragEvent) => {
        e.preventDefault();
        onDropOn();
      }}
      onDragEnd={onDragEnd}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 1,
        cursor: saving ? 'progress' : 'grab',
        opacity: dragging ? 0.5 : 1,
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 24, textAlign: 'center' }}>
        {index + 1}
      </Typography>
      <Typography sx={{ flexGrow: 1 }}>{label}</Typography>
      {index === 0 ? (
        <Typography variant="caption" color="primary" data-testid="payments-priority-first">
          {copy.firstInChain}
        </Typography>
      ) : null}
      <IconButton
        size="small"
        aria-label={copy.moveUp(label)}
        disabled={index === 0 || saving}
        onClick={() => onMove(index, index - 1)}
      >
        ↑
      </IconButton>
      <IconButton
        size="small"
        aria-label={copy.moveDown(label)}
        disabled={index === total - 1 || saving}
        onClick={() => onMove(index, index + 1)}
      >
        ↓
      </IconButton>
    </Paper>
  );
}

/**
 * The optimistic-reorder state machine, kept out of the component so the
 * render stays readable. The SERVER's response — not the local guess — sets
 * the final order, so a concurrent change elsewhere is not papered over; a
 * failure rolls the list back to where it was.
 */
function useChainReorder(
  view: MerchantSettingsView,
  client: PaymentsSettingsClient,
  onReordered?: (next: MerchantSettingsView) => void,
) {
  const copy = usePaymentsSettingsCopy().priority;
  const [chain, setChain] = useState<string[]>(() => chainOf(view));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const move = useCallback(
    (from: number, to: number) => {
      const next = reorder(chain, from, to);
      if (next.join(' ') === chain.join(' ')) return;
      const previous = chain;
      setChain(next);
      setSaving(true);
      setError(null);
      void client
        .setPriorities(next)
        .then((updated) => {
          setChain(chainOf(updated));
          onReordered?.(updated);
        })
        .catch((err: unknown) => {
          setChain(previous);
          setError(err instanceof Error ? err.message : copy.saveFailed);
        })
        .finally(() => setSaving(false));
    },
    [chain, client, onReordered],
  );

  return { chain, error, saving, move };
}

/**
 * Decline cascading — retrying a REFUSED card on the next acquirer.
 *
 * Deliberately a separate, explicit control rather than something the reorder
 * list implies. Ordering is a technical preference; this is a business
 * decision with fraud and interchange-fee consequences, and the copy says so
 * instead of leaving the merchant to discover it from their statement.
 */
function DeclinePolicyControl({
  view,
  client,
  onChanged,
}: {
  view: MerchantSettingsView;
  client: PaymentsSettingsClient;
  onChanged?: (next: MerchantSettingsView) => void;
}) {
  const copy = usePaymentsSettingsCopy().priority;
  const [saving, setSaving] = useState(false);
  const cascades = view.failoverPolicy === 'TECHNICAL_AND_DECLINE';

  return (
    <Box sx={{ mb: 2 }} data-testid="payments-decline-policy">
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={cascades}
            disabled={saving}
            // The accessible name is the same sentence with its emphasis
            // markers stripped: a screen reader must not spell out asterisks.
            inputProps={{ 'aria-label': copy.retryDeclinedLabel.replace(/\*\*/g, '') }}
            onChange={(e) => {
              setSaving(true);
              void client
                .setFailoverPolicy(e.target.checked ? 'TECHNICAL_AND_DECLINE' : 'TECHNICAL')
                .then((updated) => onChanged?.(updated))
                .finally(() => setSaving(false));
            }}
          />
        }
        label={
          <Typography variant="body2">{richText(copy.retryDeclinedLabel)}</Typography>
        }
      />
      <Typography variant="caption" color="text.secondary" display="block">
        {cascades ? copy.retryDeclinedOn : copy.retryDeclinedOff}
      </Typography>
    </Box>
  );
}

export function ProviderPriorityList({ view, client, onReordered }: ProviderPriorityListProps) {
  const { chain, error, saving, move } = useChainReorder(view, client, onReordered);
  const [dragging, setDragging] = useState<number | null>(null);

  if (chain.length === 0) {
    return (
      <Alert severity="warning" data-testid="payments-priority-empty">
        Nenhum provedor está ativo. O checkout não conseguirá cobrar até que você ative ao menos um.
      </Alert>
    );
  }

  return (
    <Box data-testid="payments-priority-list">
      <Typography variant="subtitle2" gutterBottom>
        Ordem de tentativa
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        O checkout tenta <strong>{labelOf(view.providers, chain[0] ?? '')}</strong> primeiro. Se uma
        cobrança falhar por motivo técnico, ele tenta o próximo da lista — mas só quando é possível
        comprovar que a tentativa anterior não gerou cobrança.
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 1.5 }} data-testid="payments-priority-error">
          {error}
        </Alert>
      ) : null}

      <DeclinePolicyControl view={view} client={client} onChanged={onReordered} />

      <Stack spacing={1} component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {chain.map((provider, index) => (
          <PriorityRow
            key={provider}
            label={labelOf(view.providers, provider)}
            provider={provider}
            index={index}
            total={chain.length}
            saving={saving}
            dragging={dragging === index}
            onDragStart={() => setDragging(index)}
            onDropOn={() => {
              if (dragging !== null) move(dragging, index);
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            onMove={move}
          />
        ))}
      </Stack>
    </Box>
  );
}
