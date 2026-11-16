import type { ReportTransportErrorCopy } from "./screens-copy";

/**
 * What a failed call reads as when the server sent no sentence — worded as
 * `@12-apps/app-shell`'s own `restResult` pack words it, so a host on both
 * reads one failure one way. Its own module, apart from the
 * screens pack, because the default transport falls back to the en-US words
 * on its own (`httpTransport()`), and importing the whole pack for two
 * sentences would ship every screen's English with it.
 */
export const PT_BR_REPORT_TRANSPORT_ERROR_COPY: ReportTransportErrorCopy = {
  status: (status) => `Erro ${status}`,
  network: "Falha de conexão",
};
