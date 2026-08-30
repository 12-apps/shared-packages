/**
 * `@12-apps/qr/scan` — reading a QR back through a device camera.
 *
 * ## What is here, and what is deliberately not
 *
 * The **mechanics**: acquiring a stream, picking a decoder, running the loop at
 * a sane rate and frame size, and tearing all of it down on every exit path.
 * Those are hard, universal, and discovered on a device rather than in review —
 * a scanner that leaves the lens on is not something a test suite notices.
 *
 * The **pixels are not**. A viewfinder is styled chrome: it belongs to whichever
 * design system the host already ships, and a package that brought its own
 * would either fight that system or drag it in as a dependency. So this exports
 * a hook and a `<video>` ref; the surface around it is the host's.
 *
 * The **words are not either.** {@link CameraFault} is five values, not five
 * sentences — what to say about a denied camera is host copy, in the host's
 * languages.
 *
 * ## A scanned code is untrusted input
 *
 * This package hands you the decoded string and stops there, on purpose. It is
 * a sticker: anybody can print one and put it anywhere. Never navigate to what
 * comes back — REDUCE it to values you already trust (an id you then look up),
 * and route with those. A `javascript:` code, a foreign origin, a path escape
 * and a phishing link should all end at the same honest refusal.
 */
export { useQrCamera, type CameraFault, type QrCamera } from "./use-qr-camera";
export { createQrDecoder, type QrDecoder } from "./decode";
