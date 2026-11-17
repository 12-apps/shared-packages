/**
 * The identifiers of the money movement itself, as the provider reports them
 * (FUT-2239) — what a fiscal document's payment link and a reconciliation
 * quote back. Normalized by the ADAPTER, so no host reads `raw` for them. Every
 * field is optional: a provider names what it knows, and nothing is invented.
 */
export interface ChargeTransaction {
  /** The Pix txid the receiver's QR carries (BACEN tag 62/05 or the cob's `txid`). */
  txid?: string;
  /** The Pix end-to-end id (`E…`) the SPI assigned when the money moved. */
  endToEndId?: string;
  /** The card acquirer's NSU of an approval. */
  nsu?: string;
  /** The issuer's authorisation code of an approval. */
  authorizationCode?: string;
  /**
   * The 8-digit CNPJ base of the PSP that processed the charge: the adapter's
   * own constant, never derived from an end-to-end id (whose ISPB names the
   * PAYER's bank).
   */
  pspCnpjBase?: string;
  /** When the provider says the charge was paid (ISO-8601, UTC) — its clock, not ours. */
  settledAt?: string;
}
