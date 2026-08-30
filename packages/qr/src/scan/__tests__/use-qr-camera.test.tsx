/**
 * The camera's lifecycle, which is the half that bites.
 *
 * Every assertion about teardown here stands for the same real failure: a
 * scanner that leaves the lens on. Nothing crashes when that happens and no
 * test notices unless it is written — the only symptom is the indicator light
 * on somebody's phone staying lit after they closed the sheet.
 */
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQrCamera, type CameraFault } from "../use-qr-camera";

interface Harness {
  stopped: number;
  stream: MediaStream;
}

function fakeStream(): Harness {
  const harness: Harness = { stopped: 0, stream: null as unknown as MediaStream };
  const track = { stop: () => (harness.stopped += 1) } as unknown as MediaStreamTrack;
  harness.stream = { getTracks: () => [track] } as unknown as MediaStream;
  return harness;
}

/** A component that only exists to run the hook and record what it returned. */
function Probe({
  active,
  onText,
  onState,
}: {
  active: boolean;
  onText: (text: string) => void;
  onState: (state: { fault: CameraFault | null; live: boolean }) => void;
}) {
  const { videoRef, fault, live } = useQrCamera(active, onText);
  onState({ fault, live });
  return <video ref={videoRef} data-testid="viewfinder" />;
}

let harness: Harness;

beforeEach(() => {
  harness = fakeStream();
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => harness.stream) },
  });
  // jsdom gives a <video> no dimensions and no play(); the hook reads both.
  Object.defineProperty(HTMLVideoElement.prototype, "play", {
    configurable: true,
    value: vi.fn(async () => undefined),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderProbe(active = true, onText: (text: string) => void = () => {}) {
  const states: { fault: CameraFault | null; live: boolean }[] = [];
  const view = render(
    <Probe active={active} onText={onText} onState={(state) => states.push(state)} />,
  );
  return { view, states, last: () => states[states.length - 1]! };
}

describe("opening the camera", () => {
  it("asks for the rear camera and goes live", async () => {
    const probe = renderProbe();
    await waitFor(() => expect(probe.last().live).toBe(true));
    expect(probe.last().fault).toBeNull();
    const ask = navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>;
    // `facingMode`, never a device id: the code is out in front, not the face.
    expect(ask.mock.calls[0]?.[0]).toMatchObject({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  });

  it("does not touch the camera while inactive", async () => {
    const probe = renderProbe(false);
    await act(async () => undefined);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(probe.last().live).toBe(false);
  });
});

describe("why there is no picture", () => {
  it("reports `unsupported` on an insecure origin, before any prompt", async () => {
    // getUserMedia rejects with a PERMISSION error on plain http, which would
    // tell somebody they blocked a camera they were never offered.
    vi.stubGlobal("isSecureContext", false);
    const probe = renderProbe();
    await waitFor(() => expect(probe.last().fault).toBe("unsupported"));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("reports `unsupported` where the API is absent entirely", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const probe = renderProbe();
    await waitFor(() => expect(probe.last().fault).toBe("unsupported"));
  });

  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "missing"],
    ["OverconstrainedError", "missing"],
    ["NotReadableError", "busy"],
    ["AbortError", "busy"],
    ["SomethingElse", "failed"],
  ])("maps %s to %s", async (name, expected) => {
    // Five values, not five sentences: each one is a different thing to DO
    // about it, which is why this is not a boolean.
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("nope", name);
        }),
      },
    });
    const probe = renderProbe();
    await waitFor(() => expect(probe.last().fault).toBe(expected));
    expect(probe.last().live).toBe(false);
  });
});

describe("turning the lens off", () => {
  it("stops every track on unmount", async () => {
    const probe = renderProbe();
    await waitFor(() => expect(probe.last().live).toBe(true));
    probe.view.unmount();
    expect(harness.stopped).toBe(1);
  });

  it("stops the stream that arrives AFTER unmount", async () => {
    // The subtle one: somebody closes the sheet while the permission prompt is
    // still up. The stream still arrives, and without the guard the lens stays
    // on with nothing on screen showing it.
    let grant: (stream: MediaStream) => void = () => {};
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              grant = resolve;
            }),
        ),
      },
    });
    const probe = renderProbe();
    await act(async () => undefined);
    probe.view.unmount();
    await act(async () => {
      grant(harness.stream);
      await Promise.resolve();
    });
    await waitFor(() => expect(harness.stopped).toBe(1));
  });

  it("stops the stream when `active` goes false without unmounting", async () => {
    const noop = () => {};
    const states: { fault: CameraFault | null; live: boolean }[] = [];
    const view = render(
      <Probe active onText={noop} onState={(state) => states.push(state)} />,
    );
    await waitFor(() => expect(states[states.length - 1]!.live).toBe(true));
    view.rerender(<Probe active={false} onText={noop} onState={(s) => states.push(s)} />);
    expect(harness.stopped).toBe(1);
  });
});
