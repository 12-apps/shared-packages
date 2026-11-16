/**
 * The ElevenLabs speech-to-text adapter ("Scribe"), a direct `fetch` over the
 * sealed edge: no SDK, so nothing to install and nothing the platform's
 * environment can reach. API reference: `POST /v1/speech-to-text`
 * (https://elevenlabs.io/docs/api-reference/speech-to-text/convert).
 *
 * - Request: `multipart/form-data` with `model_id` (required), `file`, and
 *   `language_code` when the host passes a hint. Auth: `xi-api-key`.
 * - Response: `text`, `language_code`, `audio_duration_secs` (nullable; the
 *   last word's `end` stands in, then the host's own `durationSeconds`), or `{ transcripts: [...] }` for multichannel.
 * - Only that one route is allowed, redirects are never followed, and the
 *   call's own key is set last on the request (B3).
 * - Credentials: API keys only.
 */
import type { ResolvedCredential } from "../credentials";
import { AudioTooLongError, InvalidResponseError, mapProviderError } from "../errors";
import type { TranscribeCall, TranscriptionAdapter, TranscriptionResult } from "../transcription";
import { sealedFetch, type SealRoute } from "./sealed-fetch";

export const ELEVENLABS_PROVIDER = "elevenlabs";
export const ELEVENLABS_DEFAULT_MODEL = "scribe_v2";

/** Where ElevenLabs' API lives; never read from the environment. */
export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";

/** The one endpoint the adapter calls. */
export const ELEVENLABS_ROUTES: readonly SealRoute[] = [{ method: "POST", path: "/v1/speech-to-text" }];

export interface ElevenLabsAdapterOptions {
  baseURL?: string;
  /** The `fetch` the adapter sends with (a proxy, a test double). */
  fetch?: typeof globalThis.fetch;
  defaultModel?: string;
}

const EXTENSIONS: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

function fileName(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return `audio.${EXTENSIONS[base] ?? "bin"}`;
}

function toElevenLabsForm(call: TranscribeCall): FormData {
  const { request, model } = call;
  const form = new FormData();
  form.set("model_id", model);
  if (request.languageHint) form.set("language_code", request.languageHint);
  const bytes: BlobPart = request.audio instanceof Blob ? request.audio : new Uint8Array(request.audio);
  form.set("file", new Blob([bytes], { type: request.mimeType }), fileName(request.mimeType));
  return form;
}

interface Chunk {
  text?: unknown;
  language_code?: unknown;
  audio_duration_secs?: unknown;
  words?: unknown;
  transcripts?: unknown;
}

function isChunk(value: unknown): value is Chunk {
  return typeof value === "object" && value !== null;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function lastWordEnd(words: unknown): number | undefined {
  if (!Array.isArray(words)) return undefined;
  const ends = words.map((word) => numberOf((word as { end?: unknown } | null)?.end)).filter((end): end is number => end !== undefined);
  return ends.length > 0 ? Math.max(...ends) : undefined;
}

/** The text of one chunk, or of every channel of a multichannel answer, joined. */
function textOf(body: Chunk): string | null {
  if (typeof body.text === "string") return body.text;
  if (!Array.isArray(body.transcripts)) return null;
  const parts = body.transcripts.map((channel: unknown) => (isChunk(channel) && typeof channel.text === "string" ? channel.text : null));
  return parts.every((part) => part !== null) ? parts.join("\n") : null;
}

function firstChunk(body: Chunk): Chunk {
  return Array.isArray(body.transcripts) && isChunk(body.transcripts[0]) ? body.transcripts[0] : body;
}

function assertWithin(durationSeconds: number, max: number | undefined): void {
  if (max !== undefined && durationSeconds > max) throw new AudioTooLongError(ELEVENLABS_PROVIDER, durationSeconds, max, false);
}

function languageOf(chunk: Chunk): string | undefined {
  return typeof chunk.language_code === "string" && chunk.language_code ? chunk.language_code : undefined;
}

function fromElevenLabsResponse(body: unknown, model: string, request: TranscribeCall["request"]): TranscriptionResult {
  if (!isChunk(body)) throw new InvalidResponseError(ELEVENLABS_PROVIDER, "The response is not an object.");
  const text = textOf(body);
  if (text === null) throw new InvalidResponseError(ELEVENLABS_PROVIDER, "The response carries no transcript text.");
  const chunk = firstChunk(body);
  const durationSeconds = numberOf(body.audio_duration_secs) ?? numberOf(chunk.audio_duration_secs) ?? lastWordEnd(chunk.words) ?? numberOf(request.durationSeconds) ?? 0;
  assertWithin(durationSeconds, request.maxDurationSeconds);
  const language = languageOf(chunk);
  return {
    provider: ELEVENLABS_PROVIDER,
    model,
    text,
    ...(language ? { language } : {}),
    durationSeconds,
    usage: { audioSeconds: durationSeconds },
  };
}

/** The provider's own words for a failure: `detail.message`, `detail[0].msg` or a string `detail`. */
function failureMessage(raw: string, status: number): string {
  try {
    const detail = (JSON.parse(raw) as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail.slice(0, 300);
    if (Array.isArray(detail) && typeof (detail[0] as { msg?: unknown } | undefined)?.msg === "string") return (detail[0] as { msg: string }).msg.slice(0, 300);
    const message = (detail as { message?: unknown } | undefined)?.message;
    if (typeof message === "string") return message.slice(0, 300);
  } catch {
    // not JSON: fall through to the status
  }
  return `HTTP ${status}`;
}

async function send(options: ElevenLabsAdapterOptions, credential: ResolvedCredential, call: TranscribeCall): Promise<unknown> {
  const baseURL = options.baseURL ?? ELEVENLABS_BASE_URL;
  const sealed = sealedFetch({
    provider: ELEVENLABS_PROVIDER,
    baseURL,
    routes: ELEVENLABS_ROUTES,
    auth: { "xi-api-key": credential.secret },
    fetch: options.fetch,
  });
  const response = await sealed(new URL("/v1/speech-to-text", baseURL), { method: "POST", body: toElevenLabsForm(call), signal: call.request.signal });
  if (!response.ok) {
    throw { status: response.status, headers: response.headers, message: failureMessage(await response.text(), response.status) };
  }
  try {
    return await response.json();
  } catch {
    throw new InvalidResponseError(ELEVENLABS_PROVIDER, "The response is not JSON.");
  }
}

export function elevenLabsAdapter(options: ElevenLabsAdapterOptions = {}): TranscriptionAdapter {
  return {
    id: ELEVENLABS_PROVIDER,
    defaultModel: options.defaultModel ?? ELEVENLABS_DEFAULT_MODEL,
    credentialKinds: ["apiKey"],
    async transcribe(call) {
      let body: unknown;
      try {
        body = await send(options, call.credential, call);
      } catch (error) {
        throw mapProviderError(ELEVENLABS_PROVIDER, error, [call.credential.secret]);
      }
      return fromElevenLabsResponse(body, call.model, call.request);
    },
  };
}
