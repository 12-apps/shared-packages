/**
 * PagBank's OFFICIAL sandbox test cards (developer.pagbank.com.br, "Cartões de
 * teste") — the only cards the homologação evidence may use (FUT-3696).
 *
 * Public test data, published by PagBank for exactly this: they authorize
 * nothing outside the sandbox. They are never sent to our server — the browser
 * encrypts them and only the encrypted blob leaves it.
 */
interface PagBankTestCard {
  scenario: "approved" | "declined" | "debit";
  brand: string;
  number: string;
  holder: string;
  expMonth: string;
  expYear: string;
  securityCode: string;
}

/**
 * December of NEXT year. PagBank's page prints 12/2026 as the example expiry,
 * and the sandbox accepts any future date; a literal would turn every run
 * after that month into a "card expired" evidence for a reason nobody chose.
 */
const TEST_EXPIRY_YEAR = String(new Date().getFullYear() + 1);

export const PAGBANK_TEST_CARDS: readonly PagBankTestCard[] = [
  {
    scenario: "approved",
    brand: "VISA",
    number: "4539620659922097",
    holder: "Jose da Silva",
    expMonth: "12",
    expYear: TEST_EXPIRY_YEAR,
    securityCode: "123",
  },
  {
    scenario: "declined",
    brand: "VISA",
    number: "4929291898380766",
    holder: "Jose da Silva",
    expMonth: "12",
    expYear: TEST_EXPIRY_YEAR,
    securityCode: "123",
  },
];

/**
 * PagBank's 3-D Secure sandbox test card (FUT-3755), charged as DEBIT. The
 * sandbox answers it by AMOUNT: authenticated for R$ 27,01
 * (`PAGBANK_SANDBOX_DEBIT_CENTS`) it is AUTHENTICATED with no challenge and
 * then PAID, so the evidence run needs no one to type a code.
 */
export const PAGBANK_3DS_TEST_CARD: PagBankTestCard = {
  scenario: "debit",
  brand: "VISA",
  number: "4000000000002701",
  holder: "Jose da Silva",
  expMonth: "12",
  expYear: TEST_EXPIRY_YEAR,
  securityCode: "123",
};

/** `4539 62** **** 2097` — the first six and last four, as a receipt prints them. */
export function maskTestCard(number: string): string {
  return `${number.slice(0, 4)} ${number.slice(4, 6)}** **** ${number.slice(-4)}`;
}
