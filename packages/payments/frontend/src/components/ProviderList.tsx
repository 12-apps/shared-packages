'use client';

import { Box, Chip, Typography } from '@mui/material';

import type { MaskedProviderConfig, MerchantSettingsView, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { connectionBadge } from './connection-state';
import { ProviderPriorityList, chainOf } from './ProviderPriorityList';
import { usePaymentsSettingsCopy } from './settings-copy-context';

/**
 * Provider picker — one card per provider, click to open it.
 *
 * Replaces a `<select>`, which hid both how many providers exist and which of
 * them actually work. The card carries that state, so the failing one is
 * visible without opening anything.
 */
function ProviderPicker({
  providers,
  configs,
  activeName,
  onSelect,
}: {
  providers: ProviderDescriptor[];
  configs: MaskedProviderConfig[];
  activeName: string | null;
  onSelect: (name: string) => void;
}) {
  const copy = usePaymentsSettingsCopy().listBadge;
  return (
    <Box
      data-testid="payments-provider-picker"
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        mb: 3,
      }}
    >
      {providers.map((provider) => {
        const config = configs.find((c) => c.provider === provider.name) ?? null;
        const badge = connectionBadge(copy, config);
        const selected = provider.name === activeName;
        return (
          <Box
            key={provider.name}
            component="button"
            type="button"
            aria-pressed={selected}
            data-testid={`payments-provider-card-${provider.name}`}
            onClick={() => onSelect(provider.name)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              width: '100%',
              p: 2,
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
              borderRadius: 1,
              border: 2,
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? 'action.selected' : 'background.paper',
            }}
          >
            <Typography variant="subtitle1">{provider.displayName}</Typography>
            <Chip
              size="small"
              data-testid={`payments-provider-badge-${provider.name}`}
              label={badge.label}
              color={badge.color}
            />
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * The landing view: choose a provider. Nothing is configured until one is
 * picked, so this screen carries only the choice.
 */
export function ProviderList({
  view,
  client,
  reload,
  onSelect,
}: {
  view: MerchantSettingsView;
  client: PaymentsSettingsClient;
  reload: () => Promise<void>;
  onSelect: (name: string) => void;
}) {
  return (
    <Box data-testid="payments-provider-settings">
      {/*
        The failover chain orders providers BETWEEN each other, so it belongs on
        the list — but only once there is an order to argue about. On a first
        visit it would be an empty box above the only thing that matters.
        Remounted on chain change so drag state starts from server truth.
      */}
      {chainOf(view).length > 1 ? (
        <Box sx={{ mb: 3 }}>
          <ProviderPriorityList
            key={chainOf(view).join(',')}
            view={view}
            client={client}
            onReordered={() => void reload()}
          />
        </Box>
      ) : null}
      <Typography variant="subtitle1">Escolha o provedor de pagamento</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Selecione onde sua loja recebe — a configuração é feita sob medida para ele.
      </Typography>
      <ProviderPicker
        providers={view.providers}
        configs={view.configs}
        activeName={null}
        onSelect={onSelect}
      />
    </Box>
  );
}
