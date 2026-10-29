/**
 * CEP FIELD TAKES `size` AND CAN FLOAT ITS LABEL (FUT-2758).
 *
 * `CepField` rendered a stacked `FormLabel` over a box that was always `md`, so
 * beside compact (`sm`) `Input`s it stood taller and labelled differently. It now
 * takes `size` (the `Input` scale) and `labelPlacement="inside"` (the `Input`
 * label, in the box). The default stays `above`, so existing callers are untouched.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PT_BR_CEP_FIELD_COPY } from '../../../../pt-BR';
import { Input } from '../../Input';
import { CepField } from '../CepField';

type Props = Partial<React.ComponentProps<typeof CepField>>;

function renderCep(props: Props = {}) {
  return render(
    <CepField copy={PT_BR_CEP_FIELD_COPY} name="postalCode" value="" onChange={() => {}} {...props} />,
  );
}

/**
 * The MUI density class the size maps to (xs/sm/md -> small, lg/xl -> medium). sm and md share a height by design. The box HEIGHT
 * is set from the same size by `fieldControlStyles` and is measured in a browser in the
 * PR; jsdom does not resolve the rem arithmetic, so the class is what a unit can pin.
 */
const sizeOf = (testId: string) =>
  screen.getByTestId(testId).closest('.MuiInputBase-root')?.classList.contains('MuiInputBase-sizeSmall')
    ? 'small'
    : 'medium';

describe('CepField size', () => {
  it('forwards size: sm is the density an sm Input has', () => {
    render(
      <>
        <Input size="sm" label="Rua" data-testid="rua" />
        <CepField copy={PT_BR_CEP_FIELD_COPY} name="postalCode" value="" onChange={() => {}} size="sm" labelPlacement="inside" />
      </>,
    );
    expect(sizeOf('rua')).toBe('small');
    expect(sizeOf('cep-field-postalCode')).toBe('small');
  });

  it('follows the Input scale: lg is the medium density, xs the small one', () => {
    const lg = renderCep({ size: 'lg' });
    expect(sizeOf('cep-field-postalCode')).toBe('medium');
    lg.unmount();
    renderCep({ size: 'xs' });
    expect(sizeOf('cep-field-postalCode')).toBe('small');
  });

  it('defaults to md, as it always has', () => {
    render(
      <>
        <Input size="md" label="Rua" data-testid="rua" />
        <CepField copy={PT_BR_CEP_FIELD_COPY} name="postalCode" value="" onChange={() => {}} />
      </>,
    );
    expect(sizeOf('cep-field-postalCode')).toBe(sizeOf('rua'));
  });
});

describe('CepField label placement', () => {
  it('keeps the stacked label by default (existing callers)', () => {
    const { container } = renderCep();
    const label = screen.getByText('CEP');
    expect(label.tagName).toBe('LABEL');
    expect(container.querySelectorAll('.MuiInputLabel-root')).toHaveLength(0);
  });

  it('inside: the label is the Input label, not a stacked one', () => {
    const { container } = renderCep({ labelPlacement: 'inside' });
    expect(container.querySelector('.MuiInputLabel-root')).not.toBeNull();
    expect(container.querySelectorAll('label')).toHaveLength(1);
    expect(screen.getByLabelText('CEP')).toBe(screen.getByTestId('cep-field-postalCode'));
  });

  it('inside: the label floats up once the field has a value', () => {
    const { container, rerender } = renderCep({ labelPlacement: 'inside' });
    const label = () => container.querySelector('.MuiInputLabel-root') as HTMLElement;
    expect(label().className).not.toMatch(/MuiInputLabel-shrink/);
    rerender(
      <CepField copy={PT_BR_CEP_FIELD_COPY} name="postalCode" value="01310-100" onChange={() => {}} labelPlacement="inside" />,
    );
    expect(label().className).toMatch(/MuiInputLabel-shrink/);
  });

  it('inside: the label floats on focus', async () => {
    const { container } = renderCep({ labelPlacement: 'inside' });
    fireEvent.focusIn(screen.getByTestId('cep-field-postalCode'));
    await waitFor(() =>
      expect(container.querySelector('.MuiInputLabel-root')?.className).toMatch(/MuiInputLabel-shrink/),
    );
  });

  it('inside with no label renders none', () => {
    const { container } = renderCep({ labelPlacement: 'inside', label: '' });
    expect(container.querySelectorAll('label')).toHaveLength(0);
  });
});

describe.each(['above', 'inside'] as const)('CepField behaviour is intact (%s)', (labelPlacement) => {
  it('masks what is typed', () => {
    const onChange = vi.fn();
    renderCep({ labelPlacement, size: 'sm', onChange });
    fireEvent.change(screen.getByTestId('cep-field-postalCode'), { target: { value: '01310100' } });
    expect(onChange).toHaveBeenCalledWith('01310-100');
  });

  it('looks a complete CEP up and reports the address', async () => {
    const address = { cep: '01310100', street: 'Avenida Paulista', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP' };
    const onLookup = vi.fn().mockResolvedValue(address);
    const onResolved = vi.fn();
    renderCep({ labelPlacement, size: 'sm', value: '01310-100', onLookup, onResolved, debounceMs: 0 });
    await vi.waitFor(() => expect(onResolved).toHaveBeenCalledWith(address));
    expect(onLookup).toHaveBeenCalledWith('01310100');
  });

  it('shows the caller error and marks the input invalid', () => {
    renderCep({ labelPlacement, size: 'sm', error: 'CEP inválido' });
    expect(screen.getByText('CEP inválido')).toBeInTheDocument();
    expect(screen.getByTestId('cep-field-postalCode')).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps the status region wired to the input', () => {
    renderCep({ labelPlacement, size: 'sm' });
    expect(screen.getByTestId('cep-field-postalCode')).toHaveAttribute('aria-describedby', 'cep-field-postalCode-status');
  });
});
