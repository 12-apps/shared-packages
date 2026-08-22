import { describe, expect, it } from 'vitest';

import {
  ACCESS_INSTRUCTIONS_MAX,
  platformHomologacaoGuide,
} from '../platform/homologacao-guide';
import { PT_BR_HOMOLOGACAO_ANSWERS } from '../platform/pt-BR';

/**
 * The paste-ready homologação answers (FUT-483, packaged by FUT-573). Pinned:
 * the services list names BOTH Order and Connect, every deployment-specific
 * answer is built from the facts the host passed, and the access-instructions
 * answer stays inside the form's 255-character cap.
 */

const DEMO_STORE = 'https://app.example.com/demo-balcao/menu';

/** What a host declares about itself — here, the sample pt-BR answers. */
const FACTS = {
  brandName: 'Aurora',
  siteUrl: 'https://app.example.com',
  demoStoreUrl: DEMO_STORE,
  accessInstructions: PT_BR_HOMOLOGACAO_ANSWERS.accessInstructions(DEMO_STORE),
  productsDescription: PT_BR_HOMOLOGACAO_ANSWERS.productsDescription('Aurora'),
  slaText: PT_BR_HOMOLOGACAO_ANSWERS.slaText,
};

describe('platformHomologacaoGuide', () => {
  it('names BOTH services — Order and Connect', () => {
    const guide = platformHomologacaoGuide(FACTS);

    expect(guide.services).toEqual(['API de Pedidos e Pagamentos (Order)', 'API Connect']);
    expect(guide.integrationType).toBe('Desenvolvimento próprio');
  });

  it('builds the deployment-specific answers from the facts', () => {
    const guide = platformHomologacaoGuide(FACTS);

    expect(guide.siteUrl).toBe(FACTS.siteUrl);
    expect(guide.demoStoreUrl).toBe(FACTS.demoStoreUrl);
    expect(guide.accessInstructions).toContain(FACTS.demoStoreUrl);
    expect(guide.productsDescription).toContain('Aurora');
  });

  it('links the official form, the SIP channel and the docs', () => {
    const guide = platformHomologacaoGuide(FACTS);

    expect(guide.formUrl).toBe('https://app.pipefy.com/public/form/2e56YZLK');
    expect(guide.supportFormUrl).toBe('https://app.pipefy.com/public/form/sBlh9Nq6');
    expect(guide.docsUrl).toContain('solicitar-homologacao');
    expect(guide.exampleUrl).toContain('criar-pagar-pedido-com-cartao');
  });

  /**
   * The answer is the HOST's now (FUT-760), so the guide can no longer promise
   * it fits — what the package still owes is PagBank's number, stated where a
   * host writing that answer will find it. Measured against the sample pack,
   * with a realistically long store URL: that is the wording the origin host
   * submits, and it must not be lengthened without re-checking.
   */
  it('states the form cap, and the sample answer fits it', () => {
    const longStore = 'https://some-quite-long-deployment-name.example.com.br/demo-balcao/menu';

    expect(ACCESS_INSTRUCTIONS_MAX).toBe(255);
    expect(
      PT_BR_HOMOLOGACAO_ANSWERS.accessInstructions(longStore).length,
    ).toBeLessThanOrEqual(ACCESS_INSTRUCTIONS_MAX);
  });
});
