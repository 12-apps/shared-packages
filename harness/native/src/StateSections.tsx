import { Alert } from '@12-apps/ui/data-display/Alert';
import { EmptyState } from '@12-apps/ui/data-display/EmptyState';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Icon } from '@12-apps/ui/icons';
import { Stack } from '@12-apps/ui/layout/Stack';
import * as React from 'react';

import { Section } from './Section';

const ALERT_VARIANTS = ['info', 'success', 'warning', 'danger', 'glass', 'gradient'] as const;
const LOADING_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

export function AlertSection({ onCount }: { onCount: () => void }): React.JSX.Element {
  const [open, setOpen] = React.useState(true);
  return (
    <Section title="Alert" testID="section-alert">
      {ALERT_VARIANTS.map((variant) => (
        <Alert key={variant} variant={variant} title={`Alerta ${variant}`} testID={`alert-${variant}`}>
          O corpo do alerta na variante {variant}.
        </Alert>
      ))}
      <Alert variant="info" showIcon={false} testID="alert-no-icon">
        Sem ícone
      </Alert>
      <Alert
        variant="info"
        icon={<Icon name="Settings" color="inherit" size="sm" />}
        testID="alert-custom-icon"
      >
        Com ícone próprio
      </Alert>
      <Alert
        variant="warning"
        title="Com descrição"
        description="A descrição fica abaixo do título."
        testID="alert-described"
      />
      {open ? (
        <Alert
          variant="success"
          closable
          closeLabel="Fechar"
          onClose={() => {
            setOpen(false);
            onCount();
          }}
          testID="alert-closable"
        >
          Pode ser fechado
        </Alert>
      ) : null}
    </Section>
  );
}

export function LoadingSection(): React.JSX.Element {
  return (
    <Section title="LoadingState" testID="section-loading">
      <Stack direction="row" gap={2} align="center" wrap>
        {LOADING_SIZES.map((size) => (
          <LoadingState key={size} size={size} testID={`loading-${size}`} />
        ))}
      </Stack>
      <LoadingState message="Carregando pedidos…" testID="loading-message" />
      <LoadingState variant="skeleton" skeletonRows={3} testID="loading-skeleton" />
    </Section>
  );
}

export function ErrorSection({ onCount }: { onCount: () => void }): React.JSX.Element {
  return (
    <Section title="ErrorState" testID="section-error">
      <ErrorState message="Não foi possível carregar o cardápio." testID="error-plain" />
      <ErrorState
        title="Falha na conexão"
        message="Verifique sua internet e tente de novo."
        onRetry={onCount}
        retryLabel="Tentar de novo"
        testID="error-retry"
      />
      <ErrorState severity="warning" message="Alguns itens não foram carregados." testID="error-warning" />
    </Section>
  );
}

export function EmptySection({ onCount }: { onCount: () => void }): React.JSX.Element {
  return (
    <Section title="EmptyState" testID="section-empty">
      <EmptyState title="Nenhum pedido ainda" description="Seus pedidos aparecem aqui." testID="empty-default" />
      <EmptyState
        variant="action"
        title="Nenhum produto"
        description="Cadastre o primeiro produto da loja."
        primaryAction={{ label: 'Cadastrar', onClick: onCount }}
        secondaryAction={{ label: 'Importar', onClick: onCount }}
        testID="empty-actions"
      />
      <EmptyState variant="minimal" title="Sem resultados" testID="empty-minimal" />
    </Section>
  );
}
