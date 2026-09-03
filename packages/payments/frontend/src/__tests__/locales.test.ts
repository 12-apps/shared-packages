import { describe, expect, it } from 'vitest';

import {
  ACTIVATION_STEP_COPY,
  CARD_COPY,
  CHECKOUT_COPY,
  CHECKOUT_PAYMENT_COPY,
  CHECKOUT_SCREENS_COPY,
  CHECKOUT_VIEW_COPY,
  PAYMENT_STATUS_COPY,
  PAYMENTS_SETTINGS_COPY,
  PLATFORM_HOMOLOGACAO_COPY,
} from '../locales';
import { localeDrift } from './locale-parity';

/**
 * `tsc` already refuses a MISSING key. `localeDrift` covers the drifts it
 * cannot see, and the cases below pin what a translation could break on this
 * surface without breaking a type — every one of them about money.
 *
 * See `locale-parity.ts` for why this package mirrors the shared assertion
 * locally instead of importing it.
 */
describe('the locale packs', () => {
  it.each([
    ['ACTIVATION_STEP_COPY', ACTIVATION_STEP_COPY],
    ['CARD_COPY', CARD_COPY],
    ['CHECKOUT_SCREENS_COPY', CHECKOUT_SCREENS_COPY],
    ['CHECKOUT_COPY', CHECKOUT_COPY],
    ['CHECKOUT_VIEW_COPY', CHECKOUT_VIEW_COPY],
    ['PAYMENT_STATUS_COPY', PAYMENT_STATUS_COPY],
    ['CHECKOUT_PAYMENT_COPY', CHECKOUT_PAYMENT_COPY],
    ['PAYMENTS_SETTINGS_COPY', PAYMENTS_SETTINGS_COPY],
    ['PLATFORM_HOMOLOGACAO_COPY', PLATFORM_HOMOLOGACAO_COPY],
  ])('%s speaks both languages the same way', (name, pack) => {
    expect(localeDrift(pack as never), name).toEqual([]);
  });

  it('keeps the activation step\'s untranslatables in both languages', () => {
    // The three classes `copy-pt-BR.ts` names, asserted rather than promised.
    // Each is a sentence a translator would reasonably localize and must not:
    // "Checkout Integrado" is the label on PagBank's own console, so an owner
    // sent looking for "Integrated Checkout" is looking for a screen that does
    // not exist; CPF is a Brazilian document; and the mask is a FORMAT, so a
    // translated one shows a shape the field refuses.
    for (const copy of Object.values(ACTIVATION_STEP_COPY)) {
      expect(copy.outcome.refusedBody('PagBank')).toContain('Checkout Integrado');
      expect(copy.outcome.blockedBody).toContain('Checkout Integrado');
      expect(copy.taxId.label).toContain('CPF');
      // The hint names the PROVIDER rather than the document — it is the
      // sentence explaining who demands the field, and a provider's name is a
      // name. It is an ARGUMENT now rather than a literal (FUT-675): both packs
      // had spelled PagBank into the string, so a Stone activation told the
      // owner PagBank required their CPF. What must not be translated is the
      // name that passes through, which is what this asserts.
      // Probed with a name that is NOT the old hardcode: passing 'PagBank'
      // here is the one argument that cannot tell an interpolating pack from
      // one that re-hardcodes PagBank and ignores its parameter.
      expect(copy.taxId.hint('Stone')).toContain('Stone');
      expect(copy.taxId.placeholder).toBe('000.000.000-00');
    }
  });

  it('names the provider the owner is looking at, not a generic one', () => {
    // The two refusal sentences and the tax-id hint are the only places a
    // provider's display name is interpolated on this step, and a pack that
    // dropped the argument would read as a plausible sentence about nothing in
    // particular — or, as the hint did before FUT-675, as a confident sentence
    // about the WRONG provider.
    for (const copy of Object.values(ACTIVATION_STEP_COPY)) {
      expect(copy.outcome.refusedTitle('InfinitePay')).toContain('InfinitePay');
      expect(copy.outcome.refusedBody('InfinitePay')).toContain('InfinitePay');
      // Probed with a name that is NOT the old hardcode, for the reason the
      // sibling case above states: 'PagBank' is the one argument that cannot
      // tell an interpolating pack from one that re-hardcodes PagBank.
      expect(copy.taxId.hint('Stone')).toContain('Stone');
      // And nothing else's name: the bug was a second provider named in a
      // sentence that already had one.
      expect(copy.taxId.hint('Stone')).not.toContain('PagBank');
    }
  });

  it('asks for the CPF without an article, so every card provider reads right', () => {
    // The WORDING, pinned per pack rather than probed.
    //
    // Everything above this asserts that the name passes THROUGH. None of it
    // can see the sentence around the name, and that sentence is the whole of
    // FUT-675's second round: `A ${displayName} exige o CPF` interpolates
    // correctly and is still wrong, because Portuguese gives PagBank a
    // masculine article ("o PagBank") and Stone and Stripe a feminine one.
    // A degenerate `(displayName) => displayName` satisfies every `toContain`
    // in this file; only an equality can reject it.
    //
    // `por` takes no contraction, which is what makes ONE string correct for
    // all three names the card flow can render. The three are spelled out
    // because the defect is per-name: a phrasing can be right for two of them.
    for (const displayName of ['PagBank', 'Stone', 'Stripe']) {
      expect(ACTIVATION_STEP_COPY['pt-BR'].taxId.hint(displayName)).toBe(
        `Exigido por ${displayName} em qualquer cobrança no cartão.`,
      );
      // The equality above pins today's sentence, which catches every
      // mechanical mutation and none of the social one: the reflexive answer to
      // a failing string equality is to paste the new string in, and that would
      // wave a restored article straight through. So the RULE is asserted too,
      // and it survives any rewording that keeps its promise.
      expect(ACTIVATION_STEP_COPY['pt-BR'].taxId.hint(displayName)).not.toMatch(
        /^[AaOo]s?\s/,
      );
      // English has no article to get wrong, and the twin is asserted anyway:
      // a pack that silently stopped interpolating is the failure `localeDrift`
      // cannot see, because it records a function as its arity alone.
      expect(ACTIVATION_STEP_COPY['en-US'].taxId.hint(displayName)).toBe(
        `${displayName} requires it on every card charge.`,
      );
    }
  });

  it('carries its own formatting locale, so words and money agree', () => {
    // A pack whose sentences were English and whose amounts were formatted
    // pt-BR would be a screen written for nobody.
    expect(CHECKOUT_PAYMENT_COPY['pt-BR'].money.amountLocale).toBe('pt-BR');
    expect(CHECKOUT_PAYMENT_COPY['en-US'].money.amountLocale).toBe('en-US');
    expect(CHECKOUT_SCREENS_COPY['pt-BR'].pix.expiryLocale).toBe('pt-BR');
    expect(CHECKOUT_SCREENS_COPY['en-US'].pix.expiryLocale).toBe('en-US');
  });

  it('keeps the schemes a buyer looks for by name', () => {
    // PIX and CPF are Brazilian and are what the buyer will search their
    // banking app for; translating them leaves them hunting.
    for (const copy of Object.values(CHECKOUT_SCREENS_COPY)) {
      expect(copy.method.pixLabel).toBe('PIX');
      expect(copy.validation.taxIdInvalid).toContain('CPF');
      expect(copy.payer.taxId('000')).toContain('CPF');
    }
    for (const copy of Object.values(CARD_COPY)) {
      expect(copy.fields.cvvLabel).toBe('CVV');
      expect(copy.fields.cpfRequired).toContain('CPF');
    }
  });

  it('says nothing was charged, on both failure screens, in both languages', () => {
    // The fear on this screen is having been charged for an order that failed.
    for (const status of Object.values(PAYMENT_STATUS_COPY)) {
      expect(status.failed.support.length).toBeGreaterThan(20);
      expect(status.expired.support.length).toBeGreaterThan(20);
      // …and the timeout screen has to say NOT to pay again, which is the
      // expensive mistake here.
      expect(status.awaitingTimedOut.support.length).toBeGreaterThan(60);
    }
  });

  it('keeps the where-the-money-goes warning blunt', () => {
    // A wrong credential pays a stranger, irreversibly. This is the sentence
    // most likely to be softened in translation, so it is pinned.
    for (const copy of Object.values(PAYMENTS_SETTINGS_COPY)) {
      expect(copy.confirmSave.warning.length).toBeGreaterThan(60);
      expect(copy.card.removeConsequenceLive.length).toBeGreaterThan(60);
      expect(copy.priority.noneActive.length).toBeGreaterThan(40);
    }
  });

  it("keeps the emphasis markers the surface renders as bold", () => {
    for (const copy of Object.values(PAYMENTS_SETTINGS_COPY)) {
      expect(copy.credentials.reverifyWarning('Acme')).toContain('**');
      expect(copy.priority.chainExplainer('Acme')).toContain('**Acme**');
      expect(copy.priority.retryDeclinedLabel).toContain('**');
    }
  });
});
