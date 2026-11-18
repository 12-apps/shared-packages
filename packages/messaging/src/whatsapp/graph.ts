import { ChannelSendFailure } from "../core/channel";
import type { OutboundContent } from "../core/types";

/**
 * The only way the adapter reaches Meta: an injected fetch. The global
 * `fetch` satisfies it; a test answers it with a recording fake.
 *
 * A JSON call reads `text()` only. A media download also asks for
 * `redirect: "manual"` (a 3xx comes back as itself, never followed) and reads
 * the binary body through `body` (a stream, read up to the size cap) or, when
 * there is none, `arrayBuffer()`. All three are optional so a text-only fake
 * still satisfies the port.
 */
export type FetchPort = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** `manual` for a media download: a redirect is answered, never followed. */
  redirect?: "manual" | "follow" | "error";
  /** Aborts the call at a media download's deadline. */
  signal?: AbortSignal;
}

export interface FetchResponse {
  status: number;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  /** The body as a stream; read chunk by chunk so an oversized one is cut off early. */
  body?: { getReader(): FetchBodyReader; cancel?(reason?: unknown): Promise<void> } | null;
  headers?: { get(name: string): string | null };
}

export interface FetchBodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
}

/**
 * The hosts Meta serves WhatsApp media from: the URL a media lookup returns is
 * `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=…`, and the
 * CDN families behind it. `*.` matches any subdomain (not the bare domain).
 */
export const DEFAULT_META_MEDIA_HOSTS: readonly string[] = ["lookaside.fbsbx.com", "*.fbcdn.net", "*.whatsapp.net"];

/** Where the Graph API is, and through what. Both numbers are config, never constants in the adapter. */
export interface GraphConfig {
  fetch: FetchPort;
  /** `https://graph.facebook.com` — no trailing slash needed. */
  baseUrl: string;
  /** `v23.0` — the Graph API version every call is pinned to. */
  apiVersion: string;
  /**
   * The hosts a media URL may point at; any other is refused before the token
   * is sent to it. Exact names, or `*.domain` for its subdomains. Default
   * {@link DEFAULT_META_MEDIA_HOSTS}.
   */
  mediaHosts?: readonly string[];
}

/** A Graph call that did not answer 2xx. Carries Meta's error code; never the token. */
export class GraphError extends ChannelSendFailure {
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(code, message);
    this.name = "GraphError";
    this.status = status;
  }
}

type Json = Record<string, unknown>;

interface GraphCall {
  method: "GET" | "POST";
  path: string;
  token?: string;
  query?: Record<string, string>;
  body?: unknown;
  redirect?: FetchInit["redirect"];
  signal?: AbortSignal;
}

/** Drops trailing "/" characters in one linear pass (a regex here backtracks quadratically on library input). */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

/** The URL and the request init of one call. The token travels in a header, never in the URL. */
function requestOf(graph: GraphConfig, call: GraphCall) {
  const base = trimTrailingSlashes(graph.baseUrl);
  const query = call.query ? `?${new URLSearchParams(call.query).toString()}` : "";
  const headers: Record<string, string> = { accept: "application/json" };
  if (call.token) headers.authorization = `Bearer ${call.token}`;
  if (call.body !== undefined) headers["content-type"] = "application/json";
  return {
    url: `${base}/${graph.apiVersion}/${call.path}${query}`,
    init: {
      method: call.method,
      headers,
      ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
      ...(call.redirect ? { redirect: call.redirect } : {}),
      ...(call.signal ? { signal: call.signal } : {}),
    } satisfies FetchInit,
  };
}

/** A body as a JSON object; anything else (empty, HTML, an array) as `{}`. */
function objectOf(raw: string): Json {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

/** Meta's error envelope (`{ error: { code, message } }`) as a {@link GraphError}. */
function graphErrorOf(status: number, json: Json): GraphError {
  const error = typeof json.error === "object" && json.error !== null ? (json.error as Json) : {};
  const code = error.code === undefined ? `HTTP_${status}` : String(error.code);
  const message = typeof error.message === "string" ? error.message : `Graph answered ${status}`;
  return new GraphError(status, code, message.slice(0, 300));
}

/** One Graph call; resolves to the parsed JSON body, or throws {@link GraphError}. */
export async function graphRequest(graph: GraphConfig, call: GraphCall): Promise<Json> {
  const { url, init } = requestOf(graph, call);
  const response = await graph.fetch(url, init);
  const json = objectOf(await response.text());
  if (response.status < 200 || response.status >= 300) throw graphErrorOf(response.status, json);
  return json;
}

/** The Cloud API body for one outbound message. */
export function messageBody(to: string, content: OutboundContent): Json {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (content.kind === "TEXT") return { ...base, type: "text", text: { body: content.text, preview_url: false } };
  if (content.kind === "BUTTONS") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: content.text },
        action: { buttons: content.buttons.map((button) => ({ type: "reply", reply: { id: button.id, title: button.title } })) },
      },
    };
  }
  return {
    ...base,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: content.text },
      action: {
        button: content.buttonLabel,
        sections: content.sections.map((section) => ({
          ...(section.title ? { title: section.title } : {}),
          rows: section.rows.map((row) => ({ id: row.id, title: row.title, ...(row.description ? { description: row.description } : {}) })),
        })),
      },
    },
  };
}

/** Send one message from a phone number; resolves to its wamid. */
export async function sendWhatsAppMessage(
  graph: GraphConfig,
  input: { token: string; phoneNumberId: string; to: string; content: OutboundContent },
): Promise<{ externalId: string }> {
  const json = await graphRequest(graph, {
    method: "POST",
    path: `${encodeURIComponent(input.phoneNumberId)}/messages`,
    token: input.token,
    body: messageBody(input.to, input.content),
  });
  const [first] = Array.isArray(json.messages) ? (json.messages as Json[]) : [];
  const id = first && typeof first.id === "string" ? first.id : null;
  if (!id) throw new GraphError(200, "NO_MESSAGE_ID", "Graph accepted the message but returned no id");
  return { externalId: id };
}
