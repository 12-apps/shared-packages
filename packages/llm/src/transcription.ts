/**
 * Speech to text behind the same interchangeable-provider shape as the chat
 * connector: `createTranscriber` picks a `TranscriptionAdapter` by provider id
 * from a registry the host can extend, and wraps it with what every provider
 * shares (the credential strategy and the host's retry policy). A second
 * provider is one adapter, registered next to the built-in one.
 */
import type { RetryPolicy } from "./client";
import type { CredentialKind, Credentials, ResolvedCredential } from "./credentials";
import { createCredentialSession } from "./credentials";
import { elevenLabsAdapter } from "./adapters/elevenlabs";
import { AudioTooLongError, AuthError, InvalidRequestError, LlmError, UnsupportedError } from "./errors";

/** One recording to transcribe. */
export interface TranscriptionRequest {
  /** The recording's bytes. */
  audio: Uint8Array | Blob;
  /** The recording's media type, e.g. `audio/ogg`. */
  mimeType: string;
  /** A BCP-47 / ISO 639 language code (`pt`); omitted, the provider detects it. */
  languageHint?: string;
  /** Longest recording accepted, in seconds; a longer one is refused with `AudioTooLongError`. */
  maxDurationSeconds?: number;
  /** The recording's length when the host already knows it, so a too-long one is refused before any byte is sent. */
  durationSeconds?: number;
  /** Aborts the call. */
  signal?: AbortSignal;
}

export interface TranscriptionUsage {
  /** The audio the provider processed, which is what it bills. */
  audioSeconds: number;
}

export interface TranscriptionResult {
  provider: string;
  model: string;
  text: string;
  /** The language the provider heard, when it says. */
  language?: string;
  durationSeconds: number;
  usage: TranscriptionUsage;
}

/** What the transcriber hands an adapter for one call. */
export interface TranscribeCall {
  model: string;
  request: TranscriptionRequest;
  credential: ResolvedCredential;
}

export interface TranscriptionAdapter {
  /** The provider id a host names in `createTranscriber({ provider })`. */
  readonly id: string;
  /** Used when the host names no model; an adapter may ship none. */
  readonly defaultModel?: string;
  readonly credentialKinds: readonly CredentialKind[];
  /** Transcribe one recording. Throws the package's typed errors. */
  transcribe(call: TranscribeCall): Promise<TranscriptionResult>;
}

export interface TranscriptionRegistry {
  register(adapter: TranscriptionAdapter, options?: { replace?: boolean }): TranscriptionRegistry;
  get(id: string): TranscriptionAdapter;
  has(id: string): boolean;
  ids(): string[];
}

export function createTranscriptionRegistry(adapters: readonly TranscriptionAdapter[] = []): TranscriptionRegistry {
  const byId = new Map<string, TranscriptionAdapter>();
  const registry: TranscriptionRegistry = {
    register(adapter, options = {}) {
      if (byId.has(adapter.id) && !options.replace) {
        throw new TypeError(
          `@12-apps/llm: a transcription adapter for "${adapter.id}" is already registered; pass { replace: true } to replace it.`,
        );
      }
      byId.set(adapter.id, adapter);
      return registry;
    },
    get(id) {
      const adapter = byId.get(id);
      if (!adapter) {
        throw new UnsupportedError(id, `No transcription adapter is registered for provider "${id}" (registered: ${[...byId.keys()].join(", ") || "none"}).`);
      }
      return adapter;
    },
    has: (id) => byId.has(id),
    ids: () => [...byId.keys()],
  };
  for (const adapter of adapters) registry.register(adapter);
  return registry;
}

/** Fresh instances of the built-in transcription adapters, with their defaults. */
export function builtInTranscriptionAdapters(): TranscriptionAdapter[] {
  return [elevenLabsAdapter()];
}

export interface TranscriberOptions {
  provider: string;
  /** Defaults to the adapter's default model. */
  model?: string;
  credentials: Credentials;
  retry?: RetryPolicy;
  /** Where to find adapters. Defaults to a registry of the built-in one (ElevenLabs). */
  registry?: TranscriptionRegistry;
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface Transcriber {
  readonly provider: string;
  readonly model: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function sizeOf(audio: Uint8Array | Blob): number {
  return audio instanceof Blob ? audio.size : audio.byteLength;
}

function isNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function requestProblems(request: TranscriptionRequest): string[] {
  const { maxDurationSeconds: max, durationSeconds: known } = request;
  const checks: Array<[boolean, string]> = [
    [sizeOf(request.audio) === 0, "audio is empty"],
    [!request.mimeType, "mimeType is required"],
    [max !== undefined && !(isNonNegative(max) && max > 0), "maxDurationSeconds must be a positive number"],
    [known !== undefined && !isNonNegative(known), "durationSeconds must be a non-negative number"],
  ];
  return checks.filter(([failed]) => failed).map(([, problem]) => problem);
}

function checkRequest(provider: string, request: TranscriptionRequest): void {
  const problems = requestProblems(request);
  if (problems.length > 0) throw new InvalidRequestError(provider, `Invalid transcription request:\n- ${problems.join("\n- ")}`);
  const { maxDurationSeconds: max, durationSeconds: known } = request;
  if (max !== undefined && known !== undefined && known > max) throw new AudioTooLongError(provider, known, max, true);
}

async function callWithAuth(adapter: TranscriptionAdapter, call: Omit<TranscribeCall, "credential">, credential: ResolvedCredential, renew: (used: ResolvedCredential) => Promise<ResolvedCredential | null>) {
  try {
    return await adapter.transcribe({ ...call, credential });
  } catch (error) {
    if (!(error instanceof AuthError) || error.status !== 401) throw error;
    const renewed = await renew(credential);
    if (!renewed) throw error;
    return adapter.transcribe({ ...call, credential: renewed });
  }
}

export function createTranscriber(options: TranscriberOptions): Transcriber {
  const adapter = (options.registry ?? createTranscriptionRegistry(builtInTranscriptionAdapters())).get(options.provider);
  if (!adapter.credentialKinds.includes(options.credentials.kind)) {
    throw new UnsupportedError(
      adapter.id,
      `The "${adapter.id}" adapter does not accept "${options.credentials.kind}" credentials (it accepts: ${adapter.credentialKinds.join(", ")}).`,
    );
  }
  const session = createCredentialSession(options.credentials, { now: options.now });
  const model = options.model ?? adapter.defaultModel;
  if (!model) throw new InvalidRequestError(adapter.id, `The "${adapter.id}" adapter has no default model; pass \`model\`.`);
  const retry = options.retry ?? (() => null);
  const sleep = options.sleep ?? defaultSleep;
  return {
    provider: adapter.id,
    model,
    async transcribe(request) {
      checkRequest(adapter.id, request);
      for (let attempt = 1; ; attempt += 1) {
        try {
          const credential = await session.current();
          return await callWithAuth(adapter, { model, request }, credential, (used) => session.afterUnauthorized(used));
        } catch (error) {
          if (!(error instanceof LlmError)) throw error;
          const delay = retry(error, attempt);
          if (delay === null || request.signal?.aborted) throw error;
          await sleep(delay);
        }
      }
    },
  };
}
