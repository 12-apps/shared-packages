/**
 * The ElevenLabs speech-to-text adapter and the scribe around it. No call
 * reaches the real API: every test injects a recording `fetch`.
 * Request/response fields follow `POST /v1/speech-to-text`.
 */
import { describe, expect, it } from "vitest";

import { elevenLabsAdapter, ELEVENLABS_BASE_URL, ELEVENLABS_ROUTES } from "../adapters/elevenlabs";
import { sealedFetch } from "../adapters/sealed-fetch";
import { ResolvedCredential } from "../credentials";
import { AudioTooLongError, AuthError, InvalidRequestError, InvalidResponseError, ProviderUnavailableError, RateLimitError, UnsupportedError } from "../errors";
import * as entry from "../index";
import { createTranscriber, createTranscriptionRegistry } from "../transcription";
import type { TranscriptionAdapter } from "../transcription";

const SECRET = "xi-test-secret";
const credential = new ResolvedCredential("apiKey", SECRET);
const audio = new Uint8Array([1, 2, 3, 4]);

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  form: FormData | null;
  redirect: string | undefined;
}

function recordingFetch(reply: () => Response) {
  const seen: Seen[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const parsed = new Request(input as string, init);
    const contentType = parsed.headers.get("content-type") ?? "";
    seen.push({
      url: parsed.url,
      method: parsed.method,
      headers: new Headers(init?.headers),
      form: contentType.startsWith("multipart/form-data") ? await parsed.formData() : null,
      redirect: init?.redirect,
    });
    return reply();
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const ok = { language_code: "por", language_probability: 0.98, text: "oi, quero duas pizzas", words: [{ text: "oi", type: "word", start: 0, end: 0.4 }, { text: "pizzas", type: "word", start: 2.1, end: 3.2 }], audio_duration_secs: 3.5 };

const call = (overrides = {}) => ({ model: "scribe_v1", credential, request: { audio, mimeType: "audio/ogg; codecs=opus", ...overrides } });

function transcriberFor(reply: () => Response, options: Partial<Parameters<typeof createTranscriber>[0]> = {}) {
  const recorded = recordingFetch(reply);
  const instance = createTranscriber({
    provider: "elevenlabs",
    credentials: { kind: "apiKey", apiKey: SECRET },
    registry: createTranscriptionRegistry([elevenLabsAdapter({ fetch: recorded.fetch })]),
    ...options,
  });
  return { scribe: instance, seen: recorded.seen };
}

describe("elevenlabs request mapping", () => {
  it("posts multipart to /v1/speech-to-text with model_id, language_code, the file and the key", async () => {
    const { fetch, seen } = recordingFetch(() => json(ok));
    await elevenLabsAdapter({ fetch }).transcribe(call({ languageHint: "pt" }));
    const sent = seen[0]!;
    expect(sent.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(sent.method).toBe("POST");
    expect(sent.headers.get("xi-api-key")).toBe(SECRET);
    expect(sent.form?.get("model_id")).toBe("scribe_v1");
    expect(sent.form?.get("language_code")).toBe("pt");
    const file = sent.form?.get("file") as File;
    expect(file.name).toBe("audio.ogg");
    expect(file.type).toBe("audio/ogg; codecs=opus");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio);
  });

  it("omits language_code without a hint, accepts a Blob and uses the model it is given", async () => {
    const { fetch, seen } = recordingFetch(() => json(ok));
    await elevenLabsAdapter({ fetch }).transcribe({ ...call({ audio: new Blob([audio]), mimeType: "audio/mpeg" }), model: "scribe_v2" });
    expect(seen[0]?.form?.has("language_code")).toBe(false);
    expect(seen[0]?.form?.get("model_id")).toBe("scribe_v2");
    expect((seen[0]?.form?.get("file") as File).name).toBe("audio.mp3");
  });

  it("defaults the model to scribe_v1 and lets the host change it", () => {
    expect(elevenLabsAdapter().defaultModel).toBe("scribe_v1");
    expect(elevenLabsAdapter({ defaultModel: "scribe_x" }).defaultModel).toBe("scribe_x");
  });
});

describe("elevenlabs response mapping", () => {
  it("maps text, language, duration and usage", async () => {
    const result = await elevenLabsAdapter({ fetch: recordingFetch(() => json(ok)).fetch }).transcribe(call());
    expect(result).toEqual({
      provider: "elevenlabs",
      model: "scribe_v1",
      text: "oi, quero duas pizzas",
      language: "por",
      durationSeconds: 3.5,
      usage: { audioSeconds: 3.5 },
    });
  });

  it("falls back to the last word's end when the duration is null", async () => {
    const body = { ...ok, audio_duration_secs: null };
    const result = await elevenLabsAdapter({ fetch: recordingFetch(() => json(body)).fetch }).transcribe(call());
    expect(result.durationSeconds).toBe(3.2);
  });

  it("joins a multichannel answer and reads its top-level duration", async () => {
    const body = { transcripts: [{ text: "a", language_code: "pt", words: [] }, { text: "b", words: [] }], audio_duration_secs: 2 };
    const result = await elevenLabsAdapter({ fetch: recordingFetch(() => json(body)).fetch }).transcribe(call());
    expect(result).toMatchObject({ text: "a\nb", language: "pt", durationSeconds: 2 });
  });

  it("rejects an answer without a transcript", async () => {
    const adapter = elevenLabsAdapter({ fetch: recordingFetch(() => json({ message: "queued", request_id: "r" })).fetch });
    await expect(adapter.transcribe(call())).rejects.toBeInstanceOf(InvalidResponseError);
    const notJson = elevenLabsAdapter({ fetch: recordingFetch(() => new Response("<html>", { status: 200 })).fetch });
    await expect(notJson.transcribe(call())).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it("refuses, after the call, a duration the provider reports over the limit", async () => {
    const adapter = elevenLabsAdapter({ fetch: recordingFetch(() => json({ ...ok, audio_duration_secs: 90 })).fetch });
    await expect(adapter.transcribe(call({ maxDurationSeconds: 60 }))).rejects.toMatchObject({
      name: "AudioTooLongError",
      durationSeconds: 90,
      maxDurationSeconds: 60,
      beforeSending: false,
    });
  });
});

describe("elevenlabs errors", () => {
  const failing = (status: number, body: unknown = { detail: { status: "x", message: `bad ${SECRET}` } }, headers = {}) =>
    elevenLabsAdapter({ fetch: recordingFetch(() => json(body, status, headers)).fetch }).transcribe(call());

  it("maps statuses onto the typed errors", async () => {
    await expect(failing(401)).rejects.toBeInstanceOf(AuthError);
    await expect(failing(403)).rejects.toBeInstanceOf(AuthError);
    await expect(failing(429, {}, { "retry-after": "2" })).rejects.toMatchObject({ name: "RateLimitError", retryAfterMs: 2000 });
    await expect(failing(500)).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(failing(422, { detail: [{ loc: ["body"], msg: "model_id required", type: "x" }] })).rejects.toMatchObject({
      name: "InvalidRequestError",
      status: 422,
      message: expect.stringContaining("model_id required"),
    });
    await expect(failing(429)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("never carries the key in a message", async () => {
    const error = await failing(401).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(SECRET);
    expect((error as Error).message).toContain("[redacted]");
  });

  it("maps a network failure to unavailable", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    await expect(elevenLabsAdapter({ fetch }).transcribe(call())).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("never follows a redirect and sends no key to it", async () => {
    const { fetch, seen } = recordingFetch(() => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    await expect(elevenLabsAdapter({ fetch }).transcribe(call())).rejects.toBeInstanceOf(InvalidRequestError);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.redirect).toBe("manual");
  });
});

describe("the sealed edge of this adapter", () => {
  const sealed = (fetch: typeof globalThis.fetch) =>
    sealedFetch({ provider: "elevenlabs", baseURL: ELEVENLABS_BASE_URL, routes: ELEVENLABS_ROUTES, auth: { "xi-api-key": SECRET }, fetch });

  it("allows only POST /v1/speech-to-text on api.elevenlabs.io", async () => {
    const { fetch, seen } = recordingFetch(() => json(ok));
    const edge = sealed(fetch);
    await expect(edge("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", body: "x" })).resolves.toBeInstanceOf(Response);
    await expect(edge("https://api.elevenlabs.io/v1/text-to-speech/abc", { method: "POST", body: "x" })).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(edge("https://api.elevenlabs.io/v1/speech-to-text", { method: "GET" })).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(edge("https://proxy.example/v1/speech-to-text", { method: "POST", body: "x" })).rejects.toBeInstanceOf(InvalidRequestError);
    expect(seen).toHaveLength(1);
  });

  it("replaces any key the caller set and drops the other account headers", async () => {
    const { fetch, seen } = recordingFetch(() => json(ok));
    await sealed(fetch)("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      body: "x",
      headers: { "xi-api-key": "platform-key", authorization: "Bearer platform" },
    });
    expect(seen[0]?.headers.get("xi-api-key")).toBe(SECRET);
    expect(seen[0]?.headers.has("authorization")).toBe(false);
  });

  it("reads no platform environment: a custom base URL is the host's explicit option only", async () => {
    const { fetch, seen } = recordingFetch(() => json(ok));
    await elevenLabsAdapter({ fetch, baseURL: "https://api.eu.residency.elevenlabs.io" }).transcribe(call());
    expect(seen[0]?.url).toBe("https://api.eu.residency.elevenlabs.io/v1/speech-to-text");
  });
});

describe("createTranscriber", () => {
  it("is built in, with credential kinds checked", () => {
    expect(createTranscriber({ provider: "elevenlabs", credentials: { kind: "apiKey", apiKey: "k" } }).model).toBe("scribe_v1");
    expect(() =>
      createTranscriber({ provider: "elevenlabs", credentials: { kind: "oauth", token: () => ({ accessToken: "t" }), refresh: () => ({ accessToken: "t" }) } }),
    ).toThrow(/does not accept "oauth"/);
    expect(() => createTranscriber({ provider: "nope", credentials: { kind: "apiKey", apiKey: "k" } })).toThrow(UnsupportedError);
  });

  it("transcribes with the resolved key", async () => {
    const built = transcriberFor(() => json(ok));
    const result = await built.scribe.transcribe({ audio, mimeType: "audio/ogg", languageHint: "pt" });
    const seen = built.seen;
    expect(result.text).toBe("oi, quero duas pizzas");
    expect(seen[0]?.headers.get("xi-api-key")).toBe(SECRET);
  });

  it("refuses a known-too-long recording before sending anything", async () => {
    const { scribe, seen } = transcriberFor(() => json(ok));
    const tooLong = scribe.transcribe({ audio, mimeType: "audio/ogg", maxDurationSeconds: 60, durationSeconds: 61 });
    await expect(tooLong).rejects.toMatchObject({ name: "AudioTooLongError", beforeSending: true });
    expect(seen).toHaveLength(0);
    const exactly = scribe.transcribe({ audio, mimeType: "audio/ogg", maxDurationSeconds: 60, durationSeconds: 60 });
    await expect(exactly).resolves.toBeDefined();
  });

  it("refuses an empty recording, no mime type and a bad limit", async () => {
    const { scribe, seen } = transcriberFor(() => json(ok));
    await expect(scribe.transcribe({ audio: new Uint8Array(), mimeType: "audio/ogg" })).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(scribe.transcribe({ audio, mimeType: "" })).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(scribe.transcribe({ audio, mimeType: "audio/ogg", maxDurationSeconds: 0 })).rejects.toBeInstanceOf(InvalidRequestError);
    expect(seen).toHaveLength(0);
  });

  it("retries through the host's hook, and AudioTooLongError is never retried", async () => {
    const replies = [() => json({}, 503), () => json(ok)];
    const { scribe, seen } = transcriberFor(() => (replies.shift() ?? replies[0]!)(), { retry: () => 0, sleep: async () => undefined });
    await expect(scribe.transcribe({ audio, mimeType: "audio/ogg" })).resolves.toMatchObject({ text: "oi, quero duas pizzas" });
    expect(seen).toHaveLength(2);
    const long = transcriberFor(() => json({ ...ok, audio_duration_secs: 99 }), { retry: (error) => (error.kind === "invalid_request" ? null : 0) });
    await expect(long.scribe.transcribe({ audio, mimeType: "audio/ogg", maxDurationSeconds: 10 })).rejects.toBeInstanceOf(AudioTooLongError);
    expect(long.seen).toHaveLength(1);
  });

  it("takes a second provider as one adapter", async () => {
    const fake: TranscriptionAdapter = {
      id: "fake",
      defaultModel: "m",
      credentialKinds: ["apiKey"],
      transcribe: async ({ model }) => ({ provider: "fake", model, text: "hi", durationSeconds: 1, usage: { audioSeconds: 1 } }),
    };
    const registry = createTranscriptionRegistry([elevenLabsAdapter(), fake]);
    expect(registry.ids()).toEqual(["elevenlabs", "fake"]);
    expect(() => registry.register(fake)).toThrow(TypeError);
    const scribe = createTranscriber({ provider: "fake", credentials: { kind: "apiKey", apiKey: "k" }, registry });
    await expect(scribe.transcribe({ audio, mimeType: "audio/ogg" })).resolves.toMatchObject({ provider: "fake", text: "hi" });
  });

  it("is exported from the entry", () => {
    for (const name of ["createTranscriber", "createTranscriptionRegistry", "builtInTranscriptionAdapters", "elevenLabsAdapter", "AudioTooLongError"] as const) {
      expect(typeof entry[name]).toBe("function");
    }
    expect(entry.ELEVENLABS_PROVIDER).toBe("elevenlabs");
  });
});
