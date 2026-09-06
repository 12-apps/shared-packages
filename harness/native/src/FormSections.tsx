import { Checkbox } from '@12-apps/ui/form/Checkbox';
import { Input } from '@12-apps/ui/form/Input';
import { Select } from '@12-apps/ui/form/Select';
import { Switch } from '@12-apps/ui/form/Switch';
import { Icon } from '@12-apps/ui/icons';
import { Stack } from '@12-apps/ui/layout/Stack';
import { Text } from '@12-apps/ui/typography/Text';
import * as React from 'react';

import { Section } from './Section';

const INPUT_VARIANTS = ['outlined', 'filled', 'glass', 'underline', 'gradient'] as const;
const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
const SWITCH_VARIANTS = ['default', 'ios', 'android', 'label', 'material'] as const;
const CHECKBOX_VARIANTS = ['default', 'rounded', 'toggle'] as const;

const UF_OPTIONS = [
  { value: 'sp', label: 'São Paulo' },
  { value: 'rj', label: 'Rio de Janeiro' },
  { value: 'mg', label: 'Minas Gerais', disabled: true },
];

export function InputSection(): React.JSX.Element {
  const [value, setValue] = React.useState('');
  return (
    <Section title="Input" testID="section-input">
      <Input
        label="Nome"
        placeholder="Como quer ser chamado?"
        value={value}
        onChangeText={setValue}
        testID="input-basic"
      />
      <Text testID="input-basic-value">{`Valor: ${value}`}</Text>
      {INPUT_VARIANTS.map((variant) => (
        <Input key={variant} variant={variant} label={variant} testID={`input-variant-${variant}`} />
      ))}
      {SIZES.map((size) => (
        <Input key={size} size={size} label={`Tamanho ${size}`} testID={`input-size-${size}`} />
      ))}
      <Input label="Com erro" error helperText="Campo obrigatório" testID="input-error" />
      <Input label="Desabilitado" disabled testID="input-disabled" />
      <Input
        label="Com adornos"
        startAdornment={<Icon name="Search" size="sm" color="neutral" />}
        endAdornment={<Icon name="Close" size="sm" color="neutral" />}
        testID="input-adorned"
      />
    </Section>
  );
}

export function SelectSection(): React.JSX.Element {
  const [uf, setUf] = React.useState<string | number>('');
  return (
    <Section title="Select" testID="section-select">
      <Select
        label="Estado"
        placeholder="Escolha um estado"
        options={UF_OPTIONS}
        value={uf}
        onChange={(event) => setUf(event.target.value)}
        testID="select-uf"
      />
      <Text testID="select-uf-value">{`Escolhido: ${String(uf)}`}</Text>
      <Select label="Com erro" options={UF_OPTIONS} error helperText="Escolha um estado" testID="select-error" />
      <Select label="Desabilitado" options={UF_OPTIONS} disabled testID="select-disabled" />
    </Section>
  );
}

export function ToggleSection({ onCount }: { onCount: () => void }): React.JSX.Element {
  const [on, setOn] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  return (
    <Section title="Switch and Checkbox" testID="section-toggles">
      <Switch
        checked={on}
        onChange={(_event, checked) => {
          setOn(checked);
          onCount();
        }}
        label="Receber notificações"
        testID="switch-basic"
      />
      <Text testID="switch-basic-value">{`Ligado: ${on ? 'sim' : 'não'}`}</Text>
      {SWITCH_VARIANTS.map((variant) => (
        <Switch key={variant} variant={variant} label={variant} testID={`switch-variant-${variant}`} />
      ))}
      {SIZES.map((size) => (
        <Switch key={size} size={size} label={`Tamanho ${size}`} testID={`switch-size-${size}`} />
      ))}
      <Switch label="Desabilitado" disabled testID="switch-disabled" />
      <Checkbox
        checked={agreed}
        onChange={(_event, checked) => setAgreed(checked)}
        label="Aceito os termos"
        testID="checkbox-basic"
      />
      <Text testID="checkbox-basic-value">{`Aceito: ${agreed ? 'sim' : 'não'}`}</Text>
      {CHECKBOX_VARIANTS.map((variant) => (
        <Checkbox key={variant} variant={variant} label={variant} testID={`checkbox-variant-${variant}`} />
      ))}
      <Checkbox label="Indeterminado" indeterminate testID="checkbox-indeterminate" />
      <Checkbox label="Com erro" error helperText="Obrigatório" testID="checkbox-error" />
      <Checkbox label="Desabilitado" disabled testID="checkbox-disabled" />
    </Section>
  );
}
