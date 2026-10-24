/**
 * Every word the form components used to hard-code in English is now the
 * caller's to replace, and the English one is still what a caller that names
 * nothing gets — except PhoneInput's starting country, which is Brazil.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UploadButtonCopy } from '../../../copy';
import {
  EN_US_ADDRESS_AUTOCOMPLETE_COPY,
  EN_US_PHONE_INPUT_COPY,
  EN_US_RICH_EDITOR_TOOLBAR_COPY,
  EN_US_UPLOAD_BUTTON_COPY,
} from '../../../en-US.form';
import { PT_BR_UI_LABELS } from '../../../pt-BR.labels';
import { PT_BR_ADDRESS_AUTOCOMPLETE_COPY, PT_BR_PHONE_INPUT_COPY } from '../../../pt-BR.form';
import { AddressAutocomplete } from '../AddressAutocomplete';
import { resolveAddressProps } from '../AddressAutocomplete/AddressAutocomplete.helpers';
import { AddressAutocompleteField } from '../AddressAutocomplete/AddressAutocompleteField';
import type { AddressAutocompleteCopy } from '../../../copy';
import { PhoneInput } from '../PhoneInput';
import { RichTextEditor } from '../RichTextEditor';
import { TextareaRichEditor } from '../Textarea/TextareaRichEditor';
import { UploadButton } from '../UploadButton';

afterEach(cleanup);

/** The pack as a host wrote it before the optional keys existed. */
const olderUploadCopy = (): UploadButtonCopy => {
  const { fileTooLarge: _tooLarge, uploadFailed: _failed, ...older } = EN_US_UPLOAD_BUTTON_COPY;
  return older;
};

const bigFile = () => {
  const file = new File(['x'], 'big.png', { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: 3 * 1024 * 1024 });
  return file;
};

const pick = (file: File) =>
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });

describe('UploadButton errors', () => {
  it('words the size rejection with the caller pack', () => {
    render(
      <UploadButton
        copy={{ ...EN_US_UPLOAD_BUTTON_COPY, fileTooLarge: (mb) => `Até ${mb} MB` }}
        maxSizeMB={1}
        onSelect={vi.fn()}
      />,
    );
    pick(bigFile());
    expect(screen.getByRole('alert')).toHaveTextContent('Até 1 MB');
  });

  it('keeps the English size rejection for a pack without the key', () => {
    render(<UploadButton copy={olderUploadCopy()} maxSizeMB={1} onSelect={vi.fn()} />);
    pick(bigFile());
    expect(screen.getByRole('alert')).toHaveTextContent('File size must be less than 1MB');
  });

  it('words a non-Error upload failure with the caller pack', async () => {
    render(
      <UploadButton
        copy={{ ...EN_US_UPLOAD_BUTTON_COPY, uploadFailed: 'Falha no envio' }}
        onSelect={vi.fn()}
        onUpload={() => Promise.reject('nope')}
      />,
    );
    await act(async () => {
      pick(new File(['x'], 'a.png', { type: 'image/png' }));
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Falha no envio'));
  });

  it('keeps "Upload failed" for a pack without the key', async () => {
    render(<UploadButton copy={olderUploadCopy()} onSelect={vi.fn()} onUpload={() => Promise.reject('nope')} />);
    await act(async () => {
      pick(new File(['x'], 'a.png', { type: 'image/png' }));
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Upload failed'));
  });
});

describe('PhoneInput countries', () => {
  it('starts on Brazil when no countryCode is given', () => {
    render(<PhoneInput copy={EN_US_PHONE_INPUT_COPY} />);
    expect(screen.getByTestId('country-dial-code')).toHaveTextContent('+55');
  });

  it('lists the countries by the pt-BR pack names', () => {
    render(<PhoneInput copy={PT_BR_PHONE_INPUT_COPY} />);
    fireEvent.click(screen.getByTestId('country-selector'));
    expect(screen.getByTestId('country-option-DE')).toHaveTextContent('Alemanha');
    expect(screen.getByTestId('country-option-US')).toHaveTextContent('Estados Unidos');
  });

  it('names the country in the invalid-number sentence through the pack', () => {
    render(<PhoneInput copy={PT_BR_PHONE_INPUT_COPY} countryCode="DE" defaultValue="123" />);
    expect(screen.getByText(PT_BR_PHONE_INPUT_COPY.invalidNumber('Alemanha'))).toBeInTheDocument();
  });

  it('keeps the English names for a pack without countryName', () => {
    const { countryName: _countryName, ...older } = EN_US_PHONE_INPUT_COPY;
    render(<PhoneInput copy={older} />);
    fireEvent.click(screen.getByTestId('country-selector'));
    expect(screen.getByTestId('country-option-DE')).toHaveTextContent('Germany');
  });
});

describe('PhoneInput label and placeholder', () => {
  const olderPhoneCopy = () => {
    const { label: _label, placeholder: _placeholder, ...older } = EN_US_PHONE_INPUT_COPY;
    return older;
  };

  it('keeps "Phone Number" and "Enter phone number" for a pack without the keys', () => {
    render(<PhoneInput copy={olderPhoneCopy()} />);
    expect(screen.getByLabelText('Phone Number')).toHaveAttribute('placeholder', 'Enter phone number');
  });

  it('renders the same English through the en-US pack', () => {
    render(<PhoneInput copy={EN_US_PHONE_INPUT_COPY} />);
    expect(screen.getByLabelText('Phone Number')).toHaveAttribute('placeholder', 'Enter phone number');
  });

  it('words the label and placeholder with the pt-BR pack', () => {
    render(<PhoneInput copy={PT_BR_PHONE_INPUT_COPY} />);
    expect(screen.getByLabelText(PT_BR_PHONE_INPUT_COPY.label)).toHaveAttribute(
      'placeholder',
      PT_BR_PHONE_INPUT_COPY.placeholder,
    );
  });

  it('lets the props win over the pack', () => {
    render(<PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label="Celular" placeholder="Seu número" />);
    expect(screen.getByLabelText('Celular')).toHaveAttribute('placeholder', 'Seu número');
  });

  it('falls back to the pack when a prop is passed as undefined', () => {
    render(<PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label={undefined} placeholder={undefined} />);
    expect(screen.getByLabelText(PT_BR_PHONE_INPUT_COPY.label)).toHaveAttribute(
      'placeholder',
      PT_BR_PHONE_INPUT_COPY.placeholder,
    );
  });
});

// The editor `Textarea variant="rich"` lazy-loads, rendered directly.
describe('Textarea rich editorLabel', () => {
  it('names the editing area with the caller pack when there is no placeholder', () => {
    render(<TextareaRichEditor copy={{ ...EN_US_RICH_EDITOR_TOOLBAR_COPY, editorLabel: 'Editor de texto' }} />);
    expect(screen.getByRole('textbox', { name: 'Editor de texto' })).toBeInTheDocument();
  });

  it('keeps "Rich text editor" for a pack without the key', () => {
    const { editorLabel: _editorLabel, ...older } = EN_US_RICH_EDITOR_TOOLBAR_COPY;
    render(<TextareaRichEditor copy={older} />);
    expect(screen.getByRole('textbox', { name: 'Rich text editor' })).toBeInTheDocument();
  });
});

describe('RichTextEditor labels', () => {
  it('names the toolbar and the editing area with the caller labels', () => {
    render(<RichTextEditor labels={PT_BR_UI_LABELS.richTextEditor} />);
    expect(screen.getByRole('button', { name: 'Negrito' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Editor de texto' })).toBeInTheDocument();
  });

  it('keeps the English names when no labels are given', () => {
    render(<RichTextEditor />);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Rich text editor' })).toBeInTheDocument();
  });
});

describe('AddressAutocomplete optional copy keys', () => {
  it('labels the field from the caller pack', () => {
    render(
      <AddressAutocomplete
        googleMapsApiKey="test-key"
        onSelect={vi.fn()}
        copy={{ ...EN_US_ADDRESS_AUTOCOMPLETE_COPY, label: 'Endereço', placeholder: 'Digite um endereço' }}
      />,
    );
    expect(screen.getByLabelText('Endereço')).toHaveAttribute('placeholder', 'Digite um endereço');
  });

  it('keeps "Address" for a pack written before the keys existed', () => {
    const { loadingMaps, mapsLoadFailed, useCurrentLocation } = EN_US_ADDRESS_AUTOCOMPLETE_COPY;
    render(
      <AddressAutocomplete googleMapsApiKey="test-key" onSelect={vi.fn()} copy={{ loadingMaps, mapsLoadFailed, useCurrentLocation }} />,
    );
    expect(screen.getByLabelText('Address')).toHaveAttribute('placeholder', 'Enter an address');
  });
});

// The field itself, held mid-request: no options yet and `loading` on.
describe('AddressAutocomplete loading row', () => {
  const renderLoading = (copy: AddressAutocompleteCopy) => {
    render(
      <AddressAutocompleteField
        {...resolveAddressProps({ googleMapsApiKey: 'test-key', onSelect: vi.fn(), copy })}
        inputValue="Rua Augusta"
        options={[]}
        loading
        apiError={null}
        mapsError={null}
        isLoaded
        handleInputChange={vi.fn()}
        handleSelect={vi.fn()}
        handleGetCurrentLocation={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
  };

  it('words the row with the pt-BR pack', () => {
    renderLoading(PT_BR_ADDRESS_AUTOCOMPLETE_COPY);
    expect(screen.getByText(PT_BR_ADDRESS_AUTOCOMPLETE_COPY.loadingSuggestions)).toBeInTheDocument();
  });

  it("keeps MUI's \"Loading…\" for a pack without the key", () => {
    const { loadingMaps, mapsLoadFailed, useCurrentLocation } = EN_US_ADDRESS_AUTOCOMPLETE_COPY;
    renderLoading({ loadingMaps, mapsLoadFailed, useCurrentLocation });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
