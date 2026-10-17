/**
 * The Pagamento step as ONE list, dressed as the origin host's storefront dresses
 * it (FUT-3685): the CPF asked once at the top, "PAGAMENTO RÁPIDO" with the
 * wallets, the online rows, the door group, and the bar — or, on a computer,
 * the "Resumo do pedido" column with the pay button.
 *
 * The same cart the `L-entrega` boards draw (two lines and the delivery fee,
 * R$ 27,00), the `@12-apps/ui` slots and the sticky bar — see
 * `../payments/storefront-look`. Each case is a store and a buyer:
 *
 *   - `both` (first): a new buyer, Google Pay and Apple Pay ready — the CPF at
 *     the top holds the wallets and the online rows, never the door;
 *   - `cpf-on-file`: a returning buyer — the payer line, whose "Alterar"
 *     opens the CPF at the top;
 *   - `google-only`: one wallet, full width;
 *   - `no-wallet`: a store that declares none — no block at all.
 *
 * The wallets' own APIs are stubbed (`../payments/wallet-stubs`); the money
 * path behind them is the real mount's.
 */
import type { JSX, ReactNode } from 'react';

import { mintable, MountedCheckout } from '../payments/cases';
import type { HarnessHost } from '../payments/host';
import { CaseTabs, PageIntro } from '../payments/panel';
import type { HarnessStoreSpec } from '../payments/store';
import { STOREFRONT_CART_CENTS } from '../payments/storefront-look';
import { installApplePayStub, installGooglePayStub, validateHarnessApplePayMerchant } from '../payments/wallet-stubs';

/** One store taking Pix and the card on the page, with the wallets it declares. */
function store(wallets: ('GOOGLE_PAY' | 'APPLE_PAY')[]): HarnessStoreSpec {
  return {
    amountCents: STOREFRONT_CART_CENTS,
    chain: [
      mintable('aurora', ['PIX', 'CARD'], {
        // A Pix nobody has paid yet: "Gerar Pix" leaves its screen up to be looked at.
        settlesOnPoll: false,
        wallets,
        ...(wallets.includes('GOOGLE_PAY') ? { googlePayMerchantId: 'harness-mid-1' } : {}),
      }),
    ],
  };
}

const NEW_BUYER: HarnessHost = { storefront: true, validateApplePayMerchant: validateHarnessApplePayMerchant };
const RETURNING: HarnessHost = { ...NEW_BUYER, taxIdOnFile: true, buyer: { name: 'Ana Teste' } };

/** The wallets' APIs, installed during render — before any child can feature-detect. */
function WithWallets({ children }: { children: ReactNode }): ReactNode {
  installGooglePayStub();
  installApplePayStub();
  return children;
}

/** The host's step around the list: the page colour and the "Pagamento" heading (T1). */
function PagamentoStep({ children }: { children: ReactNode }): JSX.Element {
  return (
    <section data-testid="harness-pagamento" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Pagamento</h2>
      {children}
    </section>
  );
}

function listCase(id: string, label: string, spec: HarnessStoreSpec, host: HarnessHost) {
  return {
    id,
    label,
    render: (): ReactNode => (
      <WithWallets>
        <PagamentoStep>
          <MountedCheckout spec={spec} host={host} label={`list-${id}`} />
        </PagamentoStep>
      </WithWallets>
    ),
  };
}

const CASES = [
  listCase('both', 'Duas carteiras, sem CPF', store(['GOOGLE_PAY', 'APPLE_PAY']), NEW_BUYER),
  listCase('cpf-on-file', 'CPF salvo', store(['GOOGLE_PAY', 'APPLE_PAY']), RETURNING),
  listCase('google-only', 'Só Google Pay', store(['GOOGLE_PAY']), RETURNING),
  listCase('no-wallet', 'Sem carteira', store([]), RETURNING),
];

export function PaymentsCheckoutListPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · Pagamento as one list">
        The one list as the origin host&apos;s storefront mounts it: the CPF at the top, the wallets in
        &quot;Pagamento rápido&quot;, the online rows and the door group, over the sticky bar — or
        beside &quot;Resumo do pedido&quot; on a computer.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
