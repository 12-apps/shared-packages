import { describe, expect, it } from "vitest";

import {
  BREADCRUMB_LIMIT,
  QUEUE_LIMIT,
  createTelemetry,
  type SessionMarker,
  type TelemetryFiles,
  type TelemetryReport,
  withoutHome,
} from "..";

/** The two files, in memory, with the timer run by hand. */
function memory(
  initial: { marker?: SessionMarker | null; queue?: TelemetryReport[] } = {},
) {
  const disk = {
    marker: initial.marker ?? null,
    queue: initial.queue ?? [],
  } as { marker: SessionMarker | null; queue: TelemetryReport[] };
  const files: TelemetryFiles = {
    readMarker: () => Promise.resolve(disk.marker),
    writeMarker: (marker) => {
      disk.marker = structuredClone(marker);
      return Promise.resolve();
    },
    removeMarkerSync: () => {
      disk.marker = null;
    },
    readQueue: () => Promise.resolve(structuredClone(disk.queue)),
    writeQueue: (queue) => {
      disk.queue = structuredClone(queue);
      return Promise.resolve();
    },
  };
  const timers: (() => void)[] = [];
  return {
    disk,
    files,
    later: (run: () => void) => void timers.push(run),
    timers,
  };
}

const NOW = () => new Date("2026-09-25T18:00:00.000Z");

function previousRun(overrides: Partial<SessionMarker> = {}): SessionMarker {
  return {
    version: "0.1.60",
    startedAt: "2026-09-25T17:00:00.000Z",
    breadcrumbs: [{ at: "2026-09-25T17:59:59.000Z", text: "menu open" }],
    installing: null,
    ...overrides,
  };
}

describe("telemetry", () => {
  it("reads a marker left behind as a crash of THAT run, with its trail and its dumps", async () => {
    const box = memory({ marker: previousRun() });
    const telemetry = createTelemetry({
      files: box.files,
      version: "0.1.67",
      now: NOW,
      later: box.later,
    });

    await telemetry.start(() => Promise.resolve(["a.dmp"]));

    expect(box.disk.queue).toEqual([
      expect.objectContaining({
        kind: "crash",
        version: "0.1.60",
        breadcrumbs: [{ at: "2026-09-25T17:59:59.000Z", text: "menu open" }],
        details: { startedAt: "2026-09-25T17:00:00.000Z", dumps: "a.dmp" },
      }),
    ]);
    // And this run's own marker is now on disk.
    expect(box.disk.marker).toMatchObject({
      version: "0.1.67",
      installing: null,
    });
  });

  it("reads a marker with no crash dump as the PC being switched off, not a crash", async () => {
    // Windows emits no will-quit on a shutdown or logoff; a counter does that nightly.
    const box = memory({ marker: previousRun() });
    const telemetry = createTelemetry({
      files: box.files,
      version: "0.1.60",
      now: NOW,
      later: box.later,
    });

    await telemetry.start(() => Promise.resolve([]));

    expect(box.disk.queue).toEqual([]);
  });

  it("knows it is the relaunch an update started, so it stays in the tray", async () => {
    const box = memory({ marker: previousRun({ installing: "0.1.67" }) });
    const relaunched = createTelemetry({
      files: box.files,
      version: "0.1.67",
      now: NOW,
      later: box.later,
    });
    await relaunched.start();
    expect(relaunched.startedByUpdate()).toBe(true);

    const byHand = createTelemetry({
      files: memory().files,
      version: "0.1.67",
      now: NOW,
      later: box.later,
    });
    await byHand.start();
    expect(byHand.startedByUpdate()).toBe(false);
  });

  it("takes the user's name out of a path before anything is sent", () => {
    expect(withoutHome("at C:\\Users\\ana\\AppData\\x.js")).toBe(
      "at ~\\AppData\\x.js",
    );
    expect(withoutHome("/home/ana/.config/x")).toBe("~/.config/x");
  });

  it("reports nothing after a clean quit", async () => {
    const box = memory();
    const first = createTelemetry({
      files: box.files,
      version: "1",
      now: NOW,
      later: box.later,
    });
    await first.start();
    first.end();

    const second = createTelemetry({
      files: box.files,
      version: "1",
      now: NOW,
      later: box.later,
    });
    await second.start();

    expect(box.disk.queue).toEqual([]);
  });

  it("says nothing when a restart to install came back as the new version", async () => {
    const box = memory({ marker: previousRun({ installing: "0.1.67" }) });
    const telemetry = createTelemetry({
      files: box.files,
      version: "0.1.67",
      now: NOW,
      later: box.later,
    });

    await telemetry.start();

    expect(box.disk.queue).toEqual([]);
  });

  it("reports an install that never happened", async () => {
    // A real afternoon: restarted to install 0.1.67, came back as 0.1.60.
    const box = memory({ marker: previousRun({ installing: "0.1.67" }) });
    const telemetry = createTelemetry({
      files: box.files,
      version: "0.1.60",
      now: NOW,
      later: box.later,
    });

    await telemetry.start();

    expect(box.disk.queue).toEqual([
      expect.objectContaining({
        kind: "install-failed",
        message: "restarted to install 0.1.67 but came back as 0.1.60",
      }),
    ]);
  });

  it("keeps the marker on a quit to install, so the next start can compare", async () => {
    const box = memory();
    const telemetry = createTelemetry({
      files: box.files,
      version: "0.1.60",
      now: NOW,
      later: box.later,
    });
    await telemetry.start();

    await telemetry.installing("0.1.67");
    telemetry.end();

    expect(box.disk.marker).toMatchObject({ installing: "0.1.67" });
  });

  it("writes breadcrumbs into the marker at most once per tick, and keeps the last thirty", async () => {
    const box = memory();
    const telemetry = createTelemetry({
      files: box.files,
      version: "1",
      now: NOW,
      later: box.later,
    });
    await telemetry.start();

    for (let step = 0; step < BREADCRUMB_LIMIT + 5; step += 1)
      telemetry.breadcrumb(`step ${step}`);

    expect(box.timers).toHaveLength(1);
    box.timers[0]?.();
    await Promise.resolve();
    const crumbs = box.disk.marker?.breadcrumbs ?? [];
    expect(crumbs).toHaveLength(BREADCRUMB_LIMIT);
    expect(crumbs[0]?.text).toBe("step 5");
  });

  it("keeps at most twenty reports, dropping the oldest", async () => {
    const box = memory();
    const telemetry = createTelemetry({
      files: box.files,
      version: "1",
      now: NOW,
      later: box.later,
    });
    await telemetry.start();

    for (let n = 0; n < QUEUE_LIMIT + 3; n += 1)
      telemetry.report({ kind: "error", message: `e${n}` });

    await Promise.resolve();
    expect(box.disk.queue).toHaveLength(QUEUE_LIMIT);
    expect(box.disk.queue[0]?.message).toBe("e3");
  });

  it("sends oldest first and keeps what a refusal left, for the next try", async () => {
    const box = memory();
    const telemetry = createTelemetry({
      files: box.files,
      version: "1",
      now: NOW,
      later: box.later,
    });
    await telemetry.start();
    telemetry.report({ kind: "error", message: "first" });
    telemetry.report({ kind: "error", message: "second" });

    const sent: string[] = [];
    await telemetry.flush((report) => {
      if (report.message === "second")
        return Promise.reject(new Error("offline"));
      sent.push(report.message);
      return Promise.resolve();
    });

    expect(sent).toEqual(["first"]);
    expect(box.disk.queue.map((report) => report.message)).toEqual(["second"]);
  });

  it("remembers the version that failed to install, so it is not retried by itself", async () => {
    const box = memory({ marker: previousRun({ installing: "0.1.67" }) });
    const telemetry = createTelemetry({
      files: box.files,
      version: "0.1.60",
      now: NOW,
      later: box.later,
    });

    await telemetry.start();

    expect(telemetry.failedInstall()).toBe("0.1.67");
  });

  it("trims a report to the ingest's caps before queueing it", async () => {
    const box = memory();
    const telemetry = createTelemetry({
      files: box.files,
      version: "1",
      now: NOW,
      later: box.later,
    });
    await telemetry.start();

    telemetry.report({
      kind: "error",
      message: "x".repeat(5000),
      stack: "y".repeat(20_000),
    });

    await Promise.resolve();
    expect(box.disk.queue[0]?.message.length).toBe(2000);
    expect(box.disk.queue[0]?.stack?.length).toBe(8000);
  });

  it("drops a report the ingest refuses for good, and sends the ones behind it", async () => {
    const box = memory();
    const telemetry = createTelemetry({
      files: box.files,
      version: "1",
      now: NOW,
      later: box.later,
    });
    await telemetry.start();
    telemetry.report({ kind: "error", message: "malformed" });
    telemetry.report({ kind: "error", message: "fine" });

    const sent: string[] = [];
    await telemetry.flush((report) => {
      if (report.message === "malformed")
        return Promise.reject(Object.assign(new Error("400"), { status: 400 }));
      sent.push(report.message);
      return Promise.resolve();
    });

    expect(sent).toEqual(["fine"]);
    expect(box.disk.queue).toEqual([]);
  });

  it("keeps everything when the refusal is one that can change (signed out)", async () => {
    const box = memory();
    const telemetry = createTelemetry({
      files: box.files,
      version: "1",
      now: NOW,
      later: box.later,
    });
    await telemetry.start();
    telemetry.report({ kind: "error", message: "later" });

    await telemetry.flush(() =>
      Promise.reject(Object.assign(new Error("401"), { status: 401 })),
    );

    expect(box.disk.queue.map((report) => report.message)).toEqual(["later"]);
  });

  it("runs one flush at a time, so nothing is sent twice", async () => {
    const box = memory();
    const telemetry = createTelemetry({
      files: box.files,
      version: "1",
      now: NOW,
      later: box.later,
    });
    await telemetry.start();
    telemetry.report({ kind: "error", message: "once" });

    const sent: string[] = [];
    const send = (report: TelemetryReport) => {
      sent.push(report.message);
      return Promise.resolve();
    };
    await Promise.all([telemetry.flush(send), telemetry.flush(send)]);

    expect(sent).toEqual(["once"]);
  });
});
