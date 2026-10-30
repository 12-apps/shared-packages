import { describe, expect, it } from 'vitest';

import { EN_US_STONE_COPY } from '../providers/en-US';
import { PT_BR_STONE_COPY } from '../providers/pt-BR';
import { stoneProvider } from '../providers/stone';

/**
 * Where the credential boxes are, said the way the screen draws them (FUT-4144).
 *
 * The form is the open step's footer: the boxes come AFTER the step's
 * instructions, as Stripe's and Itaú's guides already say ("formulário
 * abaixo"). Stone's first step told the owner to paste the keys into the form
 * "acima", sending them up the screen, past the button they had just used, to
 * look for boxes that are below. Seen in the FUT-4144 run gate at every width.
 */
describe('the Stone guide points at the credential form', () => {
  it.each([
    ['pt-BR', PT_BR_STONE_COPY, /formulário abaixo/, /formulário acima/],
    ['en-US', EN_US_STONE_COPY, /form below/, /form above/],
  ])('%s says the form is below the key step', (_locale, copy, below, above) => {
    const guide = stoneProvider(copy).setupGuide?.({ webhookUrl: 'https://example.test/hook', brandName: 'Loja' });
    const first = guide?.sections[0];
    if (!first) throw new Error('stone ships a key step');
    const text = first.steps.map((step) => step.text ?? '').join('\n');

    expect(text).toMatch(below);
    expect(text).not.toMatch(above);
  });
});

/**
 * The webhook step (step 2) has the same footer: the guide only reaches it with
 * keys stored, the boxes stay open under its instructions, and the owner is
 * asked to type the webhook user and password into them. It said "acima" too.
 */
describe('the Stone webhook step points at the credential form', () => {
  it.each([
    ['pt-BR', PT_BR_STONE_COPY, /formulário abaixo/, /formulário acima/],
    ['en-US', EN_US_STONE_COPY, /form below/, /form above/],
  ])('%s says the form is below the webhook step', (_locale, copy, below, above) => {
    const guide = stoneProvider(copy).setupGuide?.({ webhookUrl: 'https://example.test/hook', brandName: 'Loja' });
    const webhook = guide?.sections.find((section) => section.id === 'webhook');
    if (!webhook) throw new Error('stone ships a webhook step');
    const text = webhook.steps.map((step) => step.text ?? '').join('\n');

    expect(text).toMatch(below);
    expect(text).not.toMatch(above);
  });
});

/**
 * The webhook step ends by telling the owner which button to press. It named
 * "Testar conexão" above — a control the credentials path does not render. The
 * button that exists is the form's own, below, which turns on once the webhook
 * user and password are typed (FUT-4144 run gate). The labels are the
 * frontend's `credentials.saveAndTest` in each pack; this package cannot import
 * them, so they are spelled here.
 */
describe('the Stone webhook step names the button that exists', () => {
  it.each([
    ['pt-BR', PT_BR_STONE_COPY, '“Salvar e testar conexão” abaixo', /“Testar conexão”|acima:/],
    ['en-US', EN_US_STONE_COPY, '“Save and test connection” below', /“Test connection”|above:/],
  ])('%s points at the save-and-test button below', (_locale, copy, button, stale) => {
    const guide = stoneProvider(copy).setupGuide?.({ webhookUrl: 'https://example.test/hook', brandName: 'Loja' });
    const webhook = guide?.sections.find((section) => section.id === 'webhook');
    if (!webhook) throw new Error('stone ships a webhook step');
    const text = webhook.steps.map((step) => step.text ?? '').join('\n');

    expect(text).toContain(button);
    expect(text).not.toMatch(stale);
  });
});
