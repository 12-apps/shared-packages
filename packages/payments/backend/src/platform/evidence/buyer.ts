/**
 * The real cardholder a PRODUCTION run charges (FUT-4198), typed by the
 * operator. Sent with each phase, never stored: the orders carry it and the
 * recorder masks its tax id and phone before anything is kept.
 */
export interface EvidenceBuyer {
  name: string;
  email: string;
  /** CPF or CNPJ digits. */
  taxId: string;
  /** E.164-ish, as the order's customer phone. */
  phone: string;
  /**
   * What 3-D Secure asks of the debit cardholder. Echoed back to the browser
   * by phase 1 so the amount it authenticates is the amount charged; never
   * sent to PagBank by the server, never stored.
   */
  billingAddress: {
    street: string;
    number: string;
    complement?: string;
    regionCode: string;
    city: string;
    postalCode: string;
  };
}
