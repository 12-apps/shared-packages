import { describe, expect, it } from 'vitest';

import { platformHomologacaoGuide } from '../platform/homologacao-guide';

/**
 * The paste-ready homologação answers (FUT-483, packaged by FUT-573). Pinned:
 * the services list names BOTH Order and Connect, every deployment-specific
 * answer is built from the facts the host passed, and the access-instructions
 * answer stays inside the form's 255-character cap.
 */

const FACTS = {
  brandName: 'Aurora',
  siteUrl: 'https://app.example.com',
  demoStoreUrl: 'https://app.example.com/demo-balcao/menu',
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

  it('keeps the access instructions inside the form 255-character cap', () => {
    // A realistically long store URL still has to fit; the wording must not
    // be lengthened without re-checking this budget.
    const guide = platformHomologacaoGuide({
      ...FACTS,
      demoStoreUrl: 'https://some-quite-long-deployment-name.example.com.br/demo-balcao/menu',
    });

    expect(guide.accessInstructions.length).toBeLessThanOrEqual(255);
  });
});
