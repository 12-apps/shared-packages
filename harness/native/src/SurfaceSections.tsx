import { Dialog, DialogActions, DialogContent, DialogHeader } from '@12-apps/ui/feedback/Dialog';
import { Button } from '@12-apps/ui/form/Button';
import { Icon } from '@12-apps/ui/icons';
import { Card, CardActions, CardContent, CardHeader } from '@12-apps/ui/layout/Card';
import { Stack } from '@12-apps/ui/layout/Stack';
import { Text } from '@12-apps/ui/typography/Text';
import * as React from 'react';

import { Section } from './Section';

const CARD_VARIANTS = ['elevated', 'outlined', 'glass', 'gradient', 'neumorphic', 'section'] as const;
const CARD_RADII = ['none', 'sm', 'md', 'lg', 'xl'] as const;
const DIALOG_VARIANTS = ['default', 'glass', 'fullscreen', 'drawer'] as const;
const DIALOG_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

export function CardSection({ onCount }: { onCount: () => void }): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <Section title="Card" testID="section-card">
      {CARD_VARIANTS.map((variant) => (
        <Card key={variant} variant={variant} testID={`card-variant-${variant}`}>
          <CardContent>
            <Text>Um cartão {variant}.</Text>
          </CardContent>
        </Card>
      ))}
      <Stack direction="row" gap={2} wrap>
        {CARD_RADII.map((radius) => (
          <Card key={radius} borderRadius={radius} testID={`card-radius-${radius}`}>
            <CardContent dense>
              <Text size="sm">{radius}</Text>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Card testID="card-full">
        <CardHeader
          title="Pedido #1042"
          subtitle="Entregue às 19:32"
          avatar={<Icon name="Person" size="md" />}
          action={<Icon name="Settings" size="sm" />}
          testID="card-full-header"
        />
        <CardContent testID="card-full-content">
          <Text>Três itens, entrega no bairro.</Text>
        </CardContent>
        <CardActions testID="card-full-actions">
          <Button size="sm" onClick={onCount} testID="card-full-action">
            Ver
          </Button>
        </CardActions>
      </Card>
      <Card loading testID="card-loading">
        <CardContent>
          <Text>Carregando</Text>
        </CardContent>
      </Card>
      <Card interactive onClick={onCount} testID="card-interactive">
        <CardContent>
          <Text>Toque no cartão</Text>
        </CardContent>
      </Card>
      <Card
        expandable
        expanded={expanded}
        onExpandToggle={setExpanded}
        testID="card-expandable"
      >
        <CardContent>
          <Text testID="card-expandable-body">{expanded ? 'Aberto' : 'Fechado'}</Text>
        </CardContent>
      </Card>
    </Section>
  );
}

interface DemoDialogProps {
  variant: (typeof DIALOG_VARIANTS)[number];
  open: boolean;
  onClose: () => void;
}

function DemoDialog({ variant, open, onClose }: DemoDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} variant={variant} onClose={onClose} testID={`dialog-${variant}`}>
      <DialogHeader
        title={`Diálogo ${variant}`}
        subtitle="Uma pergunta"
        showCloseButton
        onClose={onClose}
        dataTestId={`dialog-${variant}`}
      />
      <DialogContent dividers>
        <Text>O corpo do diálogo na variante {variant}.</Text>
      </DialogContent>
      <DialogActions>
        <Button size="sm" variant="text" onClick={onClose} testID={`dialog-${variant}-cancel`}>
          Cancelar
        </Button>
        <Button size="sm" onClick={onClose} testID={`dialog-${variant}-confirm`}>
          Confirmar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function DialogSection(): React.JSX.Element {
  const [openVariant, setOpenVariant] = React.useState<string | null>(null);
  const [openSize, setOpenSize] = React.useState<string | null>(null);
  const close = React.useCallback(() => {
    setOpenVariant(null);
    setOpenSize(null);
  }, []);
  return (
    <Section title="Dialog" testID="section-dialog">
      <Stack direction="row" gap={1} wrap>
        {DIALOG_VARIANTS.map((variant) => (
          <Button key={variant} size="sm" onClick={() => setOpenVariant(variant)} testID={`open-dialog-${variant}`}>
            {variant}
          </Button>
        ))}
      </Stack>
      <Stack direction="row" gap={1} wrap>
        {DIALOG_SIZES.map((size) => (
          <Button key={size} size="sm" onClick={() => setOpenSize(size)} testID={`open-dialog-size-${size}`}>
            {size}
          </Button>
        ))}
      </Stack>
      {DIALOG_VARIANTS.map((variant) => (
        <DemoDialog key={variant} variant={variant} open={openVariant === variant} onClose={close} />
      ))}
      {DIALOG_SIZES.map((size) => (
        <Dialog key={size} open={openSize === size} size={size} onClose={close} testID={`dialog-size-${size}`}>
          <DialogContent>
            <Text>Tamanho {size}.</Text>
          </DialogContent>
        </Dialog>
      ))}
      {/* `persistent` refuses the backdrop and the escape key, as MUI's does. */}
      <Dialog open={openVariant === 'persistent'} persistent onClose={close} testID="dialog-persistent">
        <DialogContent>
          <Text>Não fecha pelo fundo.</Text>
        </DialogContent>
      </Dialog>
      <Button size="sm" onClick={() => setOpenVariant('persistent')} testID="open-dialog-persistent">
        persistente
      </Button>
    </Section>
  );
}
