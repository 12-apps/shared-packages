# Adopt the scale reader

The package reports what the instrument measured. The host owns physical access, device selection, pricing, plate policy, and what to do with a settled reading.

- Create a registry with `createScaleRegistry([uranoPopLight])`.
- For Electron or Node, use `createNodeSerialTransport` from `@12-apps/scales/node`. The host supplies a `serialport` handle with `autoOpen: false`. Rediscover the port path in `createPort` to tolerate a changed path after a reconnect.
- For Web Serial, give `createWebSerialTransport` from `@12-apps/scales/web` a port granted by the browser. The host is responsible for requesting permission with a user gesture.
- For React Native Android, bind an Android USB serial module to `AndroidSerialBridge` and give it to `createAndroidSerialTransport` from `@12-apps/scales/android`. Open, write, close, and data and disconnect events belong to that module. The reader and parser stay in TypeScript.
- Create a reader with `createScale({ transport, registry, profile: "urano-pop-light" })`, subscribe before calling `start()`, and await `stop()` before assigning that transport to another reader. Use `profile: "auto"` to probe supported models. A USB ID is a hint about an adapter. Detection also requires a valid response.

A `reading` reports integer net and tare grams, the instrument's stability indication or an inferred one, and the complete frame. A `settled` event normally requires two consecutive equal positive readings. The reader emits no second settled event until it sees zero, even across a disconnect. An Urano silence can indicate motion or an invalid weight. The reader reports silence separately from a transport disconnect and never treats a missing sample as zero.

A model profile owns its serial settings, poll or stream policy, and its stream parser. Capture frames from the physical model, then verify that its parser accepts split and consecutive valid frames and recovers from malformed data. Scale-side price fields in the Urano frame are unused by the reader.
