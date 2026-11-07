/**
 * Why a client metadata document was refused — for the host's log line, never
 * sent to the client (FUT-4522). `transient` marks a failure that says nothing
 * about the client (a timeout, a 5xx, a network error), as opposed to a verdict
 * on it (a bad URL, a 404, an invalid document).
 */
export class ClientMetadataDocumentError extends Error {
  readonly transient: boolean;

  constructor(message: string, options: { transient?: boolean } = {}) {
    super(message);
    this.name = "ClientMetadataDocumentError";
    this.transient = options.transient ?? false;
  }
}

/**
 * The document cannot be fetched right now and there is no earlier copy. Thrown
 * out of the client lookup on purpose: answering "unknown client" would read as
 * a permanent refusal, and a host may drop a live connection over a vendor's bad
 * minute. The surface turns it into a 503 with `Retry-After`.
 */
export class ClientMetadataUnavailableError extends Error {
  constructor(reason: string) {
    super(`client metadata document is temporarily unavailable: ${reason}`);
    this.name = "ClientMetadataUnavailableError";
  }
}
