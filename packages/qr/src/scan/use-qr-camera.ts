/**
 * The camera: open it, read frames, stop it.
 *
 * Its own module because a camera has a lifecycle and a component has a render,
 * and mixing the two is how a scanner ends up leaving the lens on. Every exit
 * from this hook — closing the surface, unmounting, a failure part-way through
 * `getUserMedia`, a decode that succeeds — goes through the same teardown, so
 * the phone's camera indicator goes out when the person expects it to.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

import { createQrDecoder } from "./decode";

/**
 * Why the camera is not running — each one a different sentence to the person
 * holding the phone, which is the whole reason this is not a boolean.
 *
 * The package deliberately ships no wording for these: what to SAY about a
 * denied camera is the host's, in the host's languages.
 */
export type CameraFault = "unsupported" | "denied" | "missing" | "busy" | "failed";

/** How often a frame is decoded. Fast enough to feel instant, slow enough to
 * leave the phone cool: a QR in frame is found within a tick or two, and the
 * ticks before that are all spent on a picture of whatever it is aimed at. */
const FRAME_INTERVAL_MS = 200;

/**
 * The longest edge handed to the decoder.
 *
 * A modern rear camera streams 1080p or better; decoding that costs several
 * times what it costs at this size and finds nothing extra, because a code
 * fills a good part of the frame by the time somebody is aiming at it.
 */
const MAX_FRAME_EDGE = 480;

/** A `getUserMedia` rejection, read as something worth telling the user. */
function faultFor(error: unknown): CameraFault {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "failed";
}

/** `facingMode` rather than a device id: the code is out in front, not the face. */
async function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** The current frame, scaled down, or `null` before the video has any pixels. */
function grabFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null {
  const { videoWidth, videoHeight } = video;
  if (videoWidth === 0 || videoHeight === 0) return null;
  const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(videoWidth, videoHeight));
  const width = Math.round(videoWidth * scale);
  const height = Math.round(videoHeight * scale);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  // `willReadFrequently`: without it browsers keep the canvas on the GPU and
  // every `getImageData` pays a readback — five times a second, forever.
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

export interface QrCamera {
  /** Attach to the `<video>`; the hook fills it once permission is granted. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Why there is no picture, or `null` while things are fine. */
  fault: CameraFault | null;
  /** The stream is live and frames are being read. */
  live: boolean;
}

/**
 * Run the camera while `active`, handing every decoded string to `onText`.
 *
 * `onText` is held in a ref rather than listed as a dependency: it is almost
 * always an inline arrow, and depending on it would tear the camera down and
 * ask for permission again on every render of the parent.
 */
export function useQrCamera(active: boolean, onText: (text: string) => void): QrCamera {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const report = useRef(onText);
  report.current = onText;
  const [fault, setFault] = useState<CameraFault | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!active) return undefined;

    // `isSecureContext` is the same gate `getUserMedia` applies, asked before
    // the prompt rather than after: on plain http the call rejects with a
    // permission error, which would tell somebody they blocked a camera they
    // were never offered.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setFault("unsupported");
      return undefined;
    }

    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement("canvas");

    const loop = (decode: Awaited<ReturnType<typeof createQrDecoder>>) => {
      timer = setTimeout(() => {
        void (async () => {
          if (stopped) return;
          const video = videoRef.current;
          const frame = video ? grabFrame(video, canvas) : null;
          const text = frame ? await decode(frame) : null;
          if (stopped) return;
          // Keeps reading either way. A decoded code is not necessarily a
          // USABLE one — a Wi-Fi QR on the same table decodes perfectly — and
          // stopping on the first success would strand somebody staring at a
          // frozen camera. The consumer ignores repeats of a code it has
          // already refused.
          if (text) report.current(text);
          loop(decode);
        })();
      }, FRAME_INTERVAL_MS);
    };

    void (async () => {
      try {
        const [opened, decode] = await Promise.all([openCamera(), createQrDecoder()]);
        stream = opened;
        // Unmounted while the permission prompt was up: the stream still
        // arrives, and without this the lens stays on with nothing showing it.
        if (stopped) return stopStream(stream);
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setFault(null);
        setLive(true);
        loop(decode);
      } catch (error) {
        if (!stopped) setFault(faultFor(error));
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stopStream(stream);
      setLive(false);
    };
  }, [active]);

  return { videoRef, fault, live };
}
