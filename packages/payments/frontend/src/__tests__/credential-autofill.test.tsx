// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  credentialSchemaOf,
  PT_BR_INFINITEPAY_COPY,
  PT_BR_ITAU_COPY,
  PT_BR_PAGBANK_COPY,
  PT_BR_PIX_MANUAL_COPY,
  PT_BR_STONE_COPY,
  PT_BR_STRIPE_COPY,
  type CredentialFieldSpec,
} from '@12-apps/payments-backend';
import { infinitePayProvider } from '@12-apps/payments-backend/providers/infinitepay';
import { itauProvider } from '@12-apps/payments-backend/providers/itau';
import { pagbankProvider } from '@12-apps/payments-backend/providers/pagbank';
import { pixManualProvider } from '@12-apps/payments-backend/providers/pixmanual';
import { stoneProvider } from '@12-apps/payments-backend/providers/stone';
import { stripeProvider } from '@12-apps/payments-backend/providers/stripe';

import { CredentialField } from '../components/CredentialFields';
import { cleanup, render } from './settings-test-utils';

/**
 * What a credential box tells the browser about itself (FUT-4144).
 *
 * A `type="password"` input with no `autocomplete` is exactly what a password
 * manager fills with the SAVED LOGIN — so the owner's panel password could be
 * offered (and offered to be saved) in a provider's secret-key box, and the
 * text credential above it ("Client ID", "Usuário") read as the username half.
 * `off` does not stop Chrome on a password field; `new-password` does. The
 * other boxes say `off`, and every box carries a stable `name` so an autofill
 * heuristic has nothing to guess from.
 */

const SECRET: CredentialFieldSpec = { key: 'clientSecret', label: 'Client Secret', secret: true, required: true };
const TEXT: CredentialFieldSpec = { key: 'clientId', label: 'Client ID', secret: false, required: true };
const PEM: CredentialFieldSpec = {
  key: 'certificate',
  label: 'Certificado',
  secret: true,
  required: false,
  multiline: true,
};
const HANDLE: CredentialFieldSpec = {
  key: 'handle',
  label: 'InfiniteTag',
  secret: false,
  required: true,
  mono: true,
};
const MINUTES: CredentialFieldSpec = {
  key: 'confirmWithinMinutes',
  label: 'Prazo para confirmar (minutos)',
  secret: false,
  required: false,
  inputMode: 'numeric',
};

/** The control CredentialField draws for `spec`: an <input>, or a <textarea> when multiline. */
function controlOf(spec: CredentialFieldSpec): HTMLInputElement | HTMLTextAreaElement {
  const control = document.getElementById(`payments-credential-${spec.key}`);
  if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement)) {
    throw new Error(`no credential control for ${spec.key}`);
  }
  return control;
}

function draw(spec: CredentialFieldSpec): HTMLInputElement | HTMLTextAreaElement {
  render(<CredentialField spec={spec} state={undefined} value="" onChange={() => undefined} />);
  return controlOf(spec);
}

describe('a credential box and autofill', () => {
  afterEach(() => cleanup());

  it('marks a secret as a new password, so the saved login is never offered in it', () => {
    const input = draw(SECRET);
    expect(input.getAttribute('type')).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('new-password');
    expect(input.getAttribute('name')).toBe('clientSecret');
  });

  it('turns autofill off on a text credential, so it is not read as the username half', () => {
    const input = draw(TEXT);
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('name')).toBe('clientId');
  });

  it('turns autofill off on a pasted PEM, which is a textarea and never a password field', () => {
    const textarea = draw(PEM);
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.getAttribute('autocomplete')).toBe('off');
    expect(textarea.getAttribute('name')).toBe('certificate');
  });

  it('keeps the monospace box unspellchecked while adding the autofill attributes', () => {
    const input = draw(HANDLE);
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('name')).toBe('handle');
  });

  it('opens the keypad the spec declares', () => {
    const input = draw(MINUTES);
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('type')).toBe('text');
  });

  it('declares no keypad when the spec names none', () => {
    expect(draw(TEXT).hasAttribute('inputmode')).toBe(false);
  });
});

describe('the Pix manual window on the form', () => {
  afterEach(() => cleanup());

  it('renders the shipped prazo field with the numeric keypad, autofill off and its name', () => {
    const schema = credentialSchemaOf(pixManualProvider(PT_BR_PIX_MANUAL_COPY));
    const spec = schema.find((field) => field.key === 'confirmWithinMinutes');
    if (!spec) throw new Error('pix manual lost its confirmation window');

    const input = draw(spec);
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('name')).toBe('confirmWithinMinutes');
  });
});

/**
 * Every shipped provider, every box: the rule above holds on the forms owners
 * actually fill, not just on hand-written specs.
 */
const SHIPPED = [
  ['stripe', credentialSchemaOf(stripeProvider(PT_BR_STRIPE_COPY))],
  ['stone', credentialSchemaOf(stoneProvider(PT_BR_STONE_COPY))],
  ['pagbank', credentialSchemaOf(pagbankProvider(PT_BR_PAGBANK_COPY))],
  ['itau', credentialSchemaOf(itauProvider(PT_BR_ITAU_COPY))],
  ['infinitepay', credentialSchemaOf(infinitePayProvider(PT_BR_INFINITEPAY_COPY))],
  ['pixmanual', credentialSchemaOf(pixManualProvider(PT_BR_PIX_MANUAL_COPY))],
] as const;

describe.each(SHIPPED)('the %s credential form', (_name, schema) => {
  afterEach(() => cleanup());

  it('names every box after its key, once', () => {
    render(
      <>
        {schema.map((spec) => (
          <CredentialField key={spec.key} spec={spec} state={undefined} value="" onChange={() => undefined} />
        ))}
      </>,
    );
    const names = schema.map((spec) => controlOf(spec).getAttribute('name'));
    expect(names).toEqual(schema.map((spec) => spec.key));
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(schema.map((spec) => [spec.key, spec] as const))(
    'gives %s the autocomplete and keypad its spec calls for',
    (_key, spec) => {
      const control = draw(spec);
      const passwordBox = control.getAttribute('type') === 'password';
      expect(control.getAttribute('autocomplete')).toBe(passwordBox ? 'new-password' : 'off');
      expect(control.getAttribute('inputmode')).toBe(spec.inputMode ?? null);
    },
  );
});
