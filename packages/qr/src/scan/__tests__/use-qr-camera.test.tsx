/**
 * The camera's lifecycle, which is the half that bites.
 *
 * Every assertion about teardown here stands for the same real failure: a
 * scanner that leaves the lens on. Nothing crashes when that happens and no
 * test notices unless it is written — the only symptom is the indicator light
 * on somebody's phone staying lit after they closed the sheet.
 *
 * The hook's state is read off the DOM rather than collected into an array by
 * a callback. Both would work; the array is shared mutable state between
 * assertions, which is what the flakiness lane refuses and what makes a suite's
 * results depend on the order it ran in.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQrCamera } from "../use-qr-camera";

/** A stream whose tracks count their own stops, so teardown is observable. */
function fakeStream(): { stopped: number; stream: MediaStream } {
  const state = { stopped: 0, stream: null as unknown as MediaStream };
  const track = { stop: () => (state.stopped += 1) } as unknown as MediaStreamTrack;
  state.stream = { getTracks: () => [track] } as unknown as MediaStream;
  return state;
}

/**
 * A component that exists only to run the hook and publish what it returned.
 *
 * The fault and live flag ride on the element as attributes so every assertion
 * reads the CURRENT render, through `waitFor`, instead of a log of past ones.
 */
function Probe({ active = true, onText = () => {} }: { active?: boolean; onText?: (t: string) => void }) {
  const { videoRef, fault, live } = useQrCamera(active, onText);
  return (
    <video
      ref={videoRef}
      data-testid="viewfinder"
      data-fault={fault ?? "none"}
      data-live={live ? "yes" : "no"}
    />
  );
}

/** The current render of the probe — read fresh, never captured. */
const viewfinder = () => screen.getByTestId("viewfinder");

let camera: ReturnType<typeof fakeStream>;

beforeEach(() => {
  camera = fakeStream();
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => camera.stream) },
  });
  // jsdom gives a <video> no play(); the hook awaits one.
  Object.defineProperty(HTMLVideoElement.prototype, "play", {
    configurable: true,
    value: vi.fn(async () => undefined),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("opening the camera", () => {
  it("asks for the rear camera and goes live", async () => {
    render(<Probe />);
    await waitFor(() => expect(viewfinder().getAttribute("data-live")).toBe("yes"));
    expect(viewfinder().getAttribute("data-fault")).toBe("none");
    const ask = navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>;
    // `facingMode`, never a device id: the code is out in front, not the face.
    expect(ask.mock.calls[0]?.[0]).toMatchObject({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  });

  it("does not touch the camera while inactive", async () => {
    render(<Probe active={false} />);
    await waitFor(() => expect(viewfinder().getAttribute("data-live")).toBe("no"));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
});

describe("why there is no picture", () => {
  it("reports `unsupported` on an insecure origin, before any prompt", async () => {
    // getUserMedia rejects with a PERMISSION error on plain http, which would
    // tell somebody they blocked a camera they were never offered.
    vi.stubGlobal("isSecureContext", false);
    render(<Probe />);
    await waitFor(() => expect(viewfinder().getAttribute("data-fault")).toBe("unsupported"));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("reports `unsupported` where the API is absent entirely", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    render(<Probe />);
    await waitFor(() => expect(viewfinder().getAttribute("data-fault")).toBe("unsupported"));
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
    // Five values, not five sentences: each is a different thing to DO about
    // it, which is why this is not a boolean.
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("nope", name);
        }),
      },
    });
    render(<Probe />);
    await waitFor(() => expect(viewfinder().getAttribute("data-fault")).toBe(expected));
    expect(viewfinder().getAttribute("data-live")).toBe("no");
  });
});

describe("turning the lens off", () => {
  it("stops every track on unmount", async () => {
    const mounted = render(<Probe />);
    await waitFor(() => expect(viewfinder().getAttribute("data-live")).toBe("yes"));
    mounted.unmount();
    expect(camera.stopped).toBe(1);
  });

  it("stops the stream that arrives AFTER unmount", async () => {
    // The subtle one: somebody closes the sheet while the permission prompt is
    // still up. The stream still arrives, and without the guard the lens stays
    // on with nothing on screen showing it.
    //
    // The resolver goes onto a container's property rather than a closed-over
    // `let` — reassigning a binding from inside a stub is what the flakiness
    // lane's `no-global-state-mutation` rule exists to catch.
    const prompt: { grant?: (stream: MediaStream) => void } = {};
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              prompt.grant = resolve;
            }),
        ),
      },
    });
    const mounted = render(<Probe />);
    await waitFor(() => expect(prompt.grant).toBeTypeOf("function"));
    mounted.unmount();
    prompt.grant?.(camera.stream);
    await waitFor(() => expect(camera.stopped).toBe(1));
  });

  it("stops the stream when `active` goes false without unmounting", async () => {
    const mounted = render(<Probe active />);
    await waitFor(() => expect(viewfinder().getAttribute("data-live")).toBe("yes"));
    mounted.rerender(<Probe active={false} />);
    await waitFor(() => expect(camera.stopped).toBe(1));
  });
});
