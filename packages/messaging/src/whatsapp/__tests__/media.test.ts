import { describe, expect, it, vi } from "vitest";

import { APP_SECRET, PHONE_NUMBER_ID, VERIFY_TOKEN } from "../../__tests__/fixtures";
import { createWhatsAppAdapter, type FetchInit, type FetchPort, type FetchResponse, type GraphConfig } from "..";

/**
 * The WhatsApp media download: a Graph lookup of the media id, then a GET of
 * the URL it returns, both with the token in a header and nowhere else. Every
 * refusal happens BEFORE the token reaches a host it should not.
 */

const TOKEN = "EAAG-SENTINEL-media-token";
const MEDIA_ID = "1234567890123456";
const MEDIA_URL = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1234567890123456&ext=1&hash=abc";
const AUDIO = new Uint8Array([79, 103, 103, 83, 0, 2, 0, 0, 0, 0]);

interface Call {
  url: string;
  init: FetchInit;
}

type Answer = Partial<FetchResponse> & { status: number; json?: unknown };

/** A recording fake: the lookup answers by the Graph path, the download by the media URL. */
function recordingGraph(answers: { lookup?: Answer; download?: Answer }, overrides: Partial<GraphConfig> = {}) {
  const recorded: Call[] = [];
  const fetch: FetchPort = async (url, init) => {
    recorded.push({ url, init });
    const answer = url.startsWith("https://graph.example.test/") ? answers.lookup : answers.download;
    if (!answer) throw new Error(`unscripted call to ${url}`);
    const { json, ...response } = answer;
    return { text: async () => JSON.stringify(json ?? {}), ...response };
  };
  const graph: GraphConfig = { fetch, baseUrl: "https://graph.example.test", apiVersion: "v23.0", ...overrides };
  const adapter = createWhatsAppAdapter({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, graph });
  const download = (maxBytes = 1024) => adapter.fetchMedia!({ credential: TOKEN, accountId: PHONE_NUMBER_ID, mediaId: MEDIA_ID, maxBytes });
  return { calls: recorded, download };
}

const lookup = (body: Record<string, unknown> = {}): Answer => ({
  status: 200,
  json: { messaging_product: "whatsapp", url: MEDIA_URL, mime_type: "audio/ogg", sha256: "abc", file_size: AUDIO.length, id: MEDIA_ID, ...body },
});
const bytes = (data: Uint8Array = AUDIO): Answer => ({ status: 200, arrayBuffer: async () => data.slice().buffer });

/** Nothing the caller can see — URLs, the error, the result — carries the token. */
function expectNoToken(calls: Call[], ...rest: unknown[]) {
  for (const call of calls) expect(call.url).not.toContain(TOKEN);
  for (const value of rest) {
    const text = value instanceof Error ? `${value.message}\n${value.stack ?? ""}` : JSON.stringify(value);
    expect(text).not.toContain(TOKEN);
  }
}

async function failure(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error("expected a refusal");
}

describe("a WhatsApp media download", () => {
  it("looks the media up, then downloads it, with the token only in the Authorization header", async () => {
    const { calls, download } = recordingGraph({ lookup: lookup(), download: bytes() });
    const media = await download();

    expect(media).toEqual({ bytes: AUDIO, mimeType: "audio/ogg", size: AUDIO.length });
    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ["GET", `https://graph.example.test/v23.0/${MEDIA_ID}`],
      ["GET", MEDIA_URL],
    ]);
    for (const call of calls) {
      expect(call.init.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.init.redirect).toBe("manual");
      expect(call.init.body).toBeUndefined();
    }
    expectNoToken(calls, media);
  });

  it("refuses a declared file_size over the cap before the second call", async () => {
    const { calls, download } = recordingGraph({ lookup: lookup({ file_size: 2048 }), download: bytes() });
    const error = await failure(download(1024));

    expect(error).toMatchObject({ name: "ChannelMediaFailure", code: "TOO_LARGE" });
    expect(calls).toHaveLength(1);
    expectNoToken(calls, error);
  });

  it("refuses a body larger than the cap even when the declared size was small", async () => {
    const { download } = recordingGraph({ lookup: lookup({ file_size: 10 }), download: bytes(new Uint8Array(2048)) });
    await expect(download(1024)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("refuses a Content-Length over the cap without reading the body", async () => {
    const body = bytes();
    const reader = vi.fn(body.arrayBuffer);
    const { download } = recordingGraph({
      lookup: lookup({ file_size: undefined }),
      download: { status: 200, headers: { get: (name) => (name === "content-length" ? "4096" : null) }, arrayBuffer: reader },
    });
    await expect(download(1024)).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(reader).not.toHaveBeenCalled();
  });

  it("stops reading a streamed body the moment it passes the cap, and cancels it", async () => {
    const chunk = new Uint8Array(600);
    const read = vi.fn(async () => ({ done: false, value: chunk }));
    const cancel = vi.fn(async () => undefined);
    const stream = { getReader: () => ({ read, cancel }) };
    const { download } = recordingGraph({ lookup: lookup({ file_size: 10 }), download: { status: 200, body: stream } });

    await expect(download(1024)).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("refuses a media URL on a host that is not a Meta media host, before sending it the token", async () => {
    for (const url of ["https://evil.example.test/a.ogg", "https://fbcdn.net.evil.test/a.ogg", "https://evilfbcdn.net/a.ogg"]) {
      const { calls, download } = recordingGraph({ lookup: lookup({ url }), download: bytes() });
      const error = await failure(download());
      expect(error).toMatchObject({ code: "MEDIA_HOST_REFUSED" });
      expect(calls).toHaveLength(1);
      expectNoToken(calls, error);
    }
  });

  it("accepts the Meta CDN families, and a host list from the config", async () => {
    for (const url of ["https://mmg.whatsapp.net/v/t62/a.enc", "https://scontent.xx.fbcdn.net/a.ogg"]) {
      const { download } = recordingGraph({ lookup: lookup({ url }), download: bytes() });
      await expect(download()).resolves.toMatchObject({ size: AUDIO.length });
    }
    const configured = recordingGraph({ lookup: lookup({ url: "https://media.example.test/a" }), download: bytes() }, { mediaHosts: ["media.example.test"] });
    await expect(configured.download()).resolves.toMatchObject({ size: AUDIO.length });
    const narrowed = recordingGraph({ lookup: lookup(), download: bytes() }, { mediaHosts: ["media.example.test"] });
    await expect(narrowed.download()).rejects.toMatchObject({ code: "MEDIA_HOST_REFUSED" });
  });

  it("refuses a media URL that is not https, or carries userinfo, or is missing", async () => {
    const cases: [unknown, string][] = [
      ["http://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", "MEDIA_URL_REFUSED"],
      ["https://user:pass@lookaside.fbsbx.com/a", "MEDIA_URL_REFUSED"],
      ["not a url", "MEDIA_URL_INVALID"],
      [undefined, "NO_MEDIA_URL"],
    ];
    for (const [url, code] of cases) {
      const { calls, download } = recordingGraph({ lookup: lookup({ url }), download: bytes() });
      await expect(download()).rejects.toMatchObject({ code });
      expect(calls).toHaveLength(1);
    }
  });

  it("refuses a 3xx from the media host instead of following it", async () => {
    const { calls, download } = recordingGraph({
      lookup: lookup(),
      download: { status: 302, headers: { get: (name) => (name === "location" ? "https://evil.example.test/" : null) } },
    });
    const error = await failure(download());

    expect(error).toMatchObject({ name: "ChannelMediaFailure", code: "REDIRECT_REFUSED" });
    expect(calls.map((call) => call.url)).toEqual([`https://graph.example.test/v23.0/${MEDIA_ID}`, MEDIA_URL]);
    expectNoToken(calls, error);
  });

  it("refuses a 3xx on the lookup too, and a non-2xx download", async () => {
    const redirected = recordingGraph({ lookup: { status: 301, json: {} } });
    await expect(redirected.download()).rejects.toMatchObject({ name: "GraphError", code: "HTTP_301" });
    expect(redirected.calls).toHaveLength(1);

    const gone = recordingGraph({ lookup: lookup(), download: { status: 404 } });
    await expect(gone.download()).rejects.toMatchObject({ code: "HTTP_404" });
  });

  it("maps a Graph error to a GraphError with Meta's code, and no token", async () => {
    const { calls, download } = recordingGraph({
      lookup: { status: 400, json: { error: { message: "Invalid OAuth access token - Cannot parse access token", code: 190 } } },
    });
    const error = await failure(download());

    expect(error).toMatchObject({ name: "GraphError", code: "190", status: 400 });
    expect(calls).toHaveLength(1);
    expectNoToken(calls, error);
  });

  it("falls back to the response's Content-Type, then to octet-stream, when the lookup names no type", async () => {
    const typed = recordingGraph({
      lookup: lookup({ mime_type: undefined }),
      download: { ...bytes(), headers: { get: (name) => (name === "content-type" ? "audio/mpeg" : null) } },
    });
    await expect(typed.download()).resolves.toMatchObject({ mimeType: "audio/mpeg" });
    const untyped = recordingGraph({ lookup: lookup({ mime_type: undefined }), download: bytes() });
    await expect(untyped.download()).resolves.toMatchObject({ mimeType: "application/octet-stream" });
  });

  it("refuses a body the fetch port cannot read as binary", async () => {
    const { download } = recordingGraph({ lookup: lookup(), download: { status: 200 } });
    await expect(download()).rejects.toMatchObject({ code: "NO_BINARY_BODY" });
  });
});

describe("the fetch port", () => {
  it("is satisfied by the global fetch", () => {
    const port: FetchPort = globalThis.fetch;
    expect(typeof port).toBe("function");
  });
});
