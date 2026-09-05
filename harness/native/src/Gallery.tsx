import { Button } from '@12-apps/ui/form/Button';
import { Icon } from '@12-apps/ui/icons';
import { Box } from '@12-apps/ui/layout/Box';
import { Stack } from '@12-apps/ui/layout/Stack';
import { Text } from '@12-apps/ui/typography/Text';
import * as React from 'react';

const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
const COLORS = ['primary', 'secondary', 'success', 'warning', 'info', 'danger', 'neutral'] as const;
const VARIANTS = ['solid', 'outline', 'ghost', 'text', 'glass', 'gradient'] as const;

function Section({ title, testID, children }: { title: string; testID: string; children: React.ReactNode }) {
  return (
    <Stack gap={1.5} testID={testID}>
      <Text variant="heading" size="lg">
        {title}
      </Text>
      {children}
    </Stack>
  );
}

/** Every ported component, every state a shared story exercises, one test id each. */
export function Gallery(): React.JSX.Element {
  const [presses, setPresses] = React.useState(0);

  return (
    <Stack gap={3} testID="gallery">
      <Section title="Text" testID="section-text">
        <Text testID="text-body">Corpo do texto, tamanho md.</Text>
        {SIZES.map((size) => (
          <Text key={size} size={size} testID={`text-size-${size}`}>
            Tamanho {size}
          </Text>
        ))}
        <Text variant="heading" testID="text-heading">
          Um título
        </Text>
        <Text variant="caption" testID="text-caption">
          Uma legenda
        </Text>
        <Text variant="code" testID="text-code">
          const x = 1;
        </Text>
        {COLORS.map((color) => (
          <Text key={color} color={color} testID={`text-color-${color}`}>
            Cor {color}
          </Text>
        ))}
        <Text italic underline strikethrough testID="text-decorated">
          Itálico, sublinhado e riscado
        </Text>
      </Section>

      <Section title="Button" testID="section-button">
        <Stack direction="row" gap={1} wrap>
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} testID={`button-variant-${variant}`}>
              {variant}
            </Button>
          ))}
        </Stack>
        <Stack direction="row" gap={1} wrap align="center">
          {SIZES.map((size) => (
            <Button key={size} size={size} testID={`button-size-${size}`}>
              {size}
            </Button>
          ))}
        </Stack>
        <Stack direction="row" gap={1} wrap>
          {COLORS.map((color) => (
            <Button key={color} color={color} testID={`button-color-${color}`}>
              {color}
            </Button>
          ))}
        </Stack>
        <Stack direction="row" gap={1} wrap align="center">
          <Button icon={<Icon name="Add" color="inherit" size="sm" />} testID="button-icon-left">
            Novo
          </Button>
          <Button icon={<Icon name="ArrowForward" color="inherit" size="sm" />} iconPosition="right" testID="button-icon-right">
            Avançar
          </Button>
          <Button icon={<Icon name="Close" color="inherit" size="sm" />} testID="button-icon-only" />
          <Button loading testID="button-loading">
            Salvando
          </Button>
          <Button disabled testID="button-disabled">
            Indisponível
          </Button>
          <Button glow testID="button-glow">
            Brilho
          </Button>
          <Button pulse testID="button-pulse">
            Pulso
          </Button>
        </Stack>
        <Stack direction="row" gap={1} align="center">
          <Button onClick={() => setPresses((n) => n + 1)} testID="button-counter">
            Contar
          </Button>
          <Text testID="button-counter-value">{`Cliques: ${presses}`}</Text>
        </Stack>
      </Section>

      <Section title="Box and Stack" testID="section-layout">
        <Box p={2} bg="paper" bordered radius="md" testID="box-bordered">
          <Text>Uma caixa com padding de duas unidades e borda.</Text>
        </Box>
        <Stack direction="row" gap={2} align="center" testID="stack-row">
          <Box p={1} bg="primary" radius="sm" testID="stack-cell-1">
            <Text color="primary">1</Text>
          </Box>
          <Box p={2} bg="secondary" radius="sm" testID="stack-cell-2">
            <Text color="primary">2</Text>
          </Box>
          <Box p={3} bg="info" radius="sm" testID="stack-cell-3">
            <Text color="primary">3</Text>
          </Box>
        </Stack>
        <Stack gap={1} divider={<Box height={1} bg="neutral" testID="stack-divider" />} testID="stack-divided">
          <Text>Primeiro</Text>
          <Text>Segundo</Text>
          <Text>Terceiro</Text>
        </Stack>
      </Section>

      <Section title="Icon" testID="section-icon">
        <Stack direction="row" gap={2} align="end">
          {SIZES.map((size) => (
            <Icon key={size} name="Search" size={size} testID={`icon-size-${size}`} />
          ))}
        </Stack>
        <Stack direction="row" gap={2}>
          {COLORS.map((color) => (
            <Icon key={color} name="CheckCircle" color={color} testID={`icon-color-${color}`} />
          ))}
        </Stack>
        <Icon name="Warning" label="Atenção" testID="icon-labelled" />
      </Section>
    </Stack>
  );
}
