// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messagesOf, transportFailure, uploadFailure } from '../failures';
import { PT_BR_WEB_STORAGE_MESSAGES } from '../pt-BR';
import { REENCODE_BYTES_PER_MS, resetMeasuredUploadRate, type UploadProgress } from '../upload-progress';
import { useUpload, type UseUploadConfig } from '../use-upload';

/**
 * The stages, the numbers and `abort()`, driven through a fake XHR: jsdom fires
 * no upload events, so `xhrFactory` hands the hook a request the test moves by
 * hand. The re-encode is a deferred the test resolves, so `preparing` lasts
 * exactly as long as a case needs it to.
 */

const optimizeImageMock = vi.hoisted(() => vi.fn<(file: File) => Promise<File>>());

vi.mock('../optimize-image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../optimize-image')>();
  return { ...actual, optimizeImage: optimizeImageMock };
});

/** Make the next re-encode wait until the test releases it. */
function holdReencode(): { release: () => void } {
  const settle: (() => void)[] = [];
  optimizeImageMock.mockImplementation(
    (file: File) =>
      new Promise<File>((resolve) => {
        settle.push(() => resolve(file));
      }),
  );
  return { release: () => settle.forEach((run) => run()) };
}

const KEY = 'products/store/3f2504e0-4f89-41d3-9a0c-0305e82c3301/full.webp';
const MAX = 8 * 1024 * 1024;

type Handler = ((event?: unknown) => void) | null;

class FakeXhr {
  upload: { onprogress: Handler; onload: Handler } = { onprogress: null, onload: null };
  onload: Handler = null;
  onerror: Handler = null;
  ontimeout: Handler = null;
  onabort: Handler = null;
  status = 0;
  responseText = '';
  opened: { method: string; url: string } | null = null;
  headers: Record<string, string> = {};
  body: unknown = null;
  aborted = false;

  open(method: string, url: string): void {
    this.opened = { method, url };
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body: unknown): void {
    this.body = body;
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
  getResponseHeader(name: string): string | null {
    return name === 'content-type' ? 'application/json' : null;
  }
  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  sent(): void {
    this.upload.onload?.();
  }
  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
  fail(): void {
    this.onerror?.();
  }
}

let xhrs: FakeXhr[] = [];
const lastXhr = (): FakeXhr => xhrs[xhrs.length - 1] as FakeXhr;

function photo(bytes = 1000): File {
  return new File([new Uint8Array(bytes)], 'p.jpg', { type: 'image/jpeg' });
}

function setup(extra: Partial<UseUploadConfig> = {}) {
  const seen: (UploadProgress | null)[] = [];
  const hook = renderHook(() => {
    const state = useUpload({
      apiBase: '/api',
      maxBytes: MAX,
      messages: PT_BR_WEB_STORAGE_MESSAGES,
      xhrFactory: () => {
        const xhr = new FakeXhr();
        xhrs.push(xhr);
        return xhr as unknown as XMLHttpRequest;
      },
      ...extra,
    });
    seen.push(state.progress);
    return state;
  });
  return { hook, seen, now: () => hook.result.current };
}

/** Let every pending promise and React update land. */
async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Start an upload inside `act`; the returned promise is what `upload()` resolves. */
function start(run: () => Promise<string | null>): Promise<string | null> {
  const started: Promise<string | null>[] = [];
  act(() => {
    started.push(run());
  });
  return started[0] as Promise<string | null>;
}

function distinctStages(seen: (UploadProgress | null)[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (const entry of seen) {
    const stage = entry?.stage ?? null;
    if (out[out.length - 1] !== stage) out.push(stage);
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  xhrs = [];
  optimizeImageMock.mockReset();
  optimizeImageMock.mockImplementation((file: File) => Promise.resolve(file));
  resetMeasuredUploadRate();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useUpload stages', () => {
  it('goes preparing → sending → saving → null, with steps 1 → 2 → 3', async () => {
    const { seen, now } = setup();
    const key = start(() => now().upload(photo()));
    expect(now().progress?.stage).toBe('preparing');
    expect(now().progress?.step).toBe(1);
    await flush();
    expect(now().progress?.stage).toBe('sending');
    expect(now().progress?.step).toBe(2);
    act(() => lastXhr().progress(1000, 1000));
    act(() => lastXhr().sent());
    expect(now().progress).toMatchObject({ stage: 'saving', step: 3, fraction: null, secondsLeft: null });
    act(() => lastXhr().respond(200, { data: { imageKey: KEY } }));
    await flush();

    await expect(key).resolves.toBe(KEY);
    expect(now().progress).toBeNull();
    expect(now().uploading).toBe(false);
    expect(distinctStages(seen)).toEqual([null, 'preparing', 'sending', 'saving', null]);
  });

  it('sends the same request: POST, the raw file, its content-type', async () => {
    const { now } = setup();
    const file = photo();
    act(() => void now().upload(file));
    await flush();
    expect(lastXhr().opened).toEqual({ method: 'POST', url: '/api/uploads/image' });
    expect(lastXhr().headers).toEqual({ 'content-type': 'image/jpeg' });
    expect(lastXhr().body).toBe(file);
  });

  it('appends `query` to the endpoint, URL-encoded', async () => {
    const { now } = setup({ query: { tenant: 'my store', next: 'a&b=c' } });
    act(() => void now().upload(photo()));
    await flush();
    expect(lastXhr().opened?.url).toBe('/api/uploads/image?tenant=my%20store&next=a%26b%3Dc');
  });

  it('keeps `secondsLeft` null until the measuring window, then a finite number', async () => {
    const { now } = setup();
    act(() => void now().upload(photo(), { optimize: false }));
    await flush();
    expect(now().progress).toMatchObject({ stage: 'sending', fraction: 0, secondsLeft: null });

    await flush(100);
    act(() => lastXhr().progress(5_000, 100_000));
    expect(now().progress?.fraction).toBeCloseTo(0.05);
    expect(now().progress?.secondsLeft).toBeNull();

    await flush(900);
    act(() => lastXhr().progress(50_000, 100_000));
    const left = now().progress?.secondsLeft;
    expect(left).not.toBeNull();
    expect(Number.isFinite(left)).toBe(true);
    expect(left as number).toBeGreaterThan(0);
  });

  it('reports `sending` with no fraction when the host gives its own fetchImpl', async () => {
    const answers: ((response: Response) => void)[] = [];
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answers.push(resolve);
        }),
    ) as unknown as typeof fetch;
    const { now } = setup({ fetchImpl });
    act(() => void now().upload(photo()));
    await flush();
    expect(now().progress).toMatchObject({ stage: 'sending', fraction: null, secondsLeft: null, step: 2 });
    expect(xhrs).toHaveLength(0);
    answers[0]?.(new Response(JSON.stringify({ data: { imageKey: KEY } }), { status: 200 }));
    await flush();
    expect(now().progress).toBeNull();
  });
});

describe('useUpload failures end with progress null and the existing message', () => {
  it('a transport error', async () => {
    const { now } = setup();
    const key = start(() => now().upload(photo()));
    await flush();
    act(() => lastXhr().fail());
    await flush();
    await expect(key).resolves.toBeNull();
    expect(now().progress).toBeNull();
    expect(now().error).toBe(transportFailure(PT_BR_WEB_STORAGE_MESSAGES));
  });

  it('a 4xx, mapped by the same refusal table', async () => {
    const { now } = setup();
    act(() => void now().upload(photo()));
    await flush();
    act(() => lastXhr().respond(403, { error: 'forbidden' }));
    await flush();
    const expected = await uploadFailure(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
      MAX,
      PT_BR_WEB_STORAGE_MESSAGES,
    );
    expect(now().progress).toBeNull();
    expect(now().error).toBe(expected);
  });

  it('an answer with no key', async () => {
    const { now } = setup();
    act(() => void now().upload(photo()));
    await flush();
    act(() => lastXhr().respond(200, { data: {} }));
    await flush();
    expect(now().progress).toBeNull();
    expect(now().error).toBe(messagesOf(MAX, PT_BR_WEB_STORAGE_MESSAGES).missing_key);
  });
});

describe('useUpload abort()', () => {
  it('mid-send: the request is aborted, progress null, no error, upload() resolves null', async () => {
    const { now } = setup();
    const key = start(() => now().upload(photo()));
    await flush();
    act(() => lastXhr().progress(300, 1000));
    act(() => now().abort());
    await flush();
    expect(lastXhr().aborted).toBe(true);
    await expect(key).resolves.toBeNull();
    expect(now().progress).toBeNull();
    expect(now().uploading).toBe(false);
    expect(now().error).toBeNull();
  });

  it('during the re-encode: resolves null at once, with no error and no request', async () => {
    const reencode = holdReencode();
    const { now } = setup();
    const key = start(() => now().upload(photo()));
    await flush(300);
    expect(now().progress?.stage).toBe('preparing');
    act(() => now().abort());
    await flush();
    await expect(key).resolves.toBeNull();
    expect(now().progress).toBeNull();
    expect(now().error).toBeNull();
    // The re-encode finishing later sends nothing.
    reencode.release();
    await flush(1000);
    expect(xhrs).toHaveLength(0);
    expect(now().progress).toBeNull();
  });
});

describe('useUpload preparing', () => {
  it('caps `fraction` at 0.95 until the re-encode really ends', async () => {
    const reencode = holdReencode();
    const { now } = setup({ estimatePrepareMs: () => 1000 });
    act(() => void now().upload(photo()));
    await flush(5000);
    expect(now().progress).toMatchObject({ stage: 'preparing', fraction: 0.95, secondsLeft: null });
    reencode.release();
    await flush();
    expect(now().progress?.stage).toBe('sending');
  });

  it('uses `estimatePrepareMs` over the default', async () => {
    holdReencode();
    const estimate = vi.fn(() => 2000);
    const { now } = setup({ estimatePrepareMs: estimate });
    const file = photo();
    act(() => void now().upload(file));
    await flush(1000);
    expect(estimate).toHaveBeenCalledWith(file);
    expect(now().progress?.fraction).toBeCloseTo(0.5, 1);
    expect(now().progress?.secondsLeft).toBeCloseTo(1, 0);
  });

  it('defaults to the file size over REENCODE_BYTES_PER_MS', async () => {
    holdReencode();
    const { now } = setup();
    // A file the constant says takes exactly one second.
    act(() => void now().upload(photo(REENCODE_BYTES_PER_MS * 1000)));
    await flush(400);
    expect(now().progress?.fraction).toBeCloseTo(0.4, 1);
  });

  it('`totalSecondsLeft` is null with no rate, finite with an assumed one', async () => {
    holdReencode();
    const bare = setup({ estimatePrepareMs: () => 2000 });
    act(() => void bare.now().upload(photo()));
    await flush(200);
    expect(bare.now().progress?.secondsLeft).not.toBeNull();
    expect(bare.now().progress?.totalSecondsLeft).toBeNull();
    bare.hook.unmount();

    const assumed = setup({ estimatePrepareMs: () => 2000, assumedBytesPerSecond: 100 });
    act(() => void assumed.now().upload(photo(1000)));
    await flush(200);
    const progress = assumed.now().progress as UploadProgress;
    // 1.8 s of re-encode left, plus 1000 bytes at 100 B/s.
    expect(progress.totalSecondsLeft).toBeCloseTo(1.8 + 10, 1);
  });

  it('`totalSecondsLeft` uses the rate an earlier upload measured', async () => {
    const { now } = setup({ estimatePrepareMs: () => 2000 });
    act(() => void now().upload(photo(), { optimize: false }));
    await flush(1000);
    act(() => lastXhr().progress(1000, 1000));
    act(() => lastXhr().sent());
    act(() => lastXhr().respond(200, { data: { imageKey: KEY } }));
    await flush();

    holdReencode();
    act(() => void now().upload(photo()));
    await flush(200);
    expect(now().progress?.totalSecondsLeft).not.toBeNull();
    expect(Number.isFinite(now().progress?.totalSecondsLeft)).toBe(true);
  });
});
