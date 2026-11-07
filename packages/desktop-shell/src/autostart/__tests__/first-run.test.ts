import { describe, expect, it } from "vitest";

import { createFirstRunAutostart, observeAutostart, type Autostart } from "../index";

/** An autostart whose state is a variable, recording every call. */
function fakeAutostart(initial: boolean, { refuses = false } = {}): Autostart & { calls: string[]; on: boolean } {
  const fake = {
    on: initial,
    calls: [] as string[],
    isEnabled: () => Promise.resolve(fake.on),
    enable: () => fake.set(true),
    disable: () => fake.set(false),
    set: (next: boolean) => {
      fake.calls.push(`set(${next})`);
      // A policy that refuses silently leaves the state as it was.
      if (!refuses) fake.on = next;
      return Promise.resolve();
    },
  };
  return fake;
}

/** The host's stored "already chose" flag. */
function flag(initial: boolean): { chosen: () => boolean; remember: () => Promise<void>; value: () => boolean } {
  let value = initial;
  return {
    chosen: () => value,
    remember: () => {
      value = true;
      return Promise.resolve();
    },
    value: () => value,
  };
}

describe("createFirstRunAutostart", () => {
  it("asks a fresh install once, and never again after the answer", async () => {
    const stored = flag(false);
    const ask = createFirstRunAutostart({ autostart: fakeAutostart(false), platform: "linux", defaultOn: true, ...stored });

    expect(ask.shouldAsk()).toBe(true);
    await ask.answer(true);

    expect(stored.value()).toBe(true);
    expect(ask.shouldAsk()).toBe(false);
  });

  it("preselects the app's own default — yes for an agent, no for a window", () => {
    const agent = createFirstRunAutostart({ autostart: fakeAutostart(false), platform: "win32", defaultOn: true, ...flag(false) });
    const register = createFirstRunAutostart({ autostart: fakeAutostart(false), platform: "win32", defaultOn: false, ...flag(false) });

    expect(agent.preselected).toBe(true);
    expect(register.preselected).toBe(false);
  });

  it("applies the answer either way and reports what the platform did", async () => {
    const on = fakeAutostart(false);
    expect(await createFirstRunAutostart({ autostart: on, platform: "linux", defaultOn: false, ...flag(false) }).answer(true)).toBe(true);
    expect(on.on).toBe(true);

    const off = fakeAutostart(true);
    expect(await createFirstRunAutostart({ autostart: off, platform: "linux", defaultOn: true, ...flag(false) }).answer(false)).toBe(false);
    expect(off.on).toBe(false);
  });

  it("answers with the read-back when the platform refuses, and still counts it as asked", async () => {
    const stored = flag(false);
    const refused = await createFirstRunAutostart({
      autostart: fakeAutostart(false, { refuses: true }),
      platform: "win32",
      defaultOn: true,
      ...stored,
    }).answer(true);

    expect(refused).toBe(false);
    expect(stored.value()).toBe(true);
  });

  it("never asks an install that already chose, and leaves its autostart alone", () => {
    // An earlier version's flag (the printer agent's `autostartChosen`): that
    // install turned autostart on at its first run, or the person changed it.
    const autostart = fakeAutostart(false);
    const ask = createFirstRunAutostart({ autostart, platform: "linux", defaultOn: true, ...flag(true) });

    expect(ask.shouldAsk()).toBe(false);
    expect(autostart.calls).toEqual([]);
  });

  it("asks only on Windows and Linux", () => {
    for (const platform of ["darwin", "freebsd", "aix"]) {
      expect(createFirstRunAutostart({ autostart: fakeAutostart(false), platform, defaultOn: true, ...flag(false) }).shouldAsk(), platform).toBe(false);
    }
  });

  it("takes a change made elsewhere before the answer as the choice", async () => {
    const stored = flag(false);
    const ask = createFirstRunAutostart({ autostart: fakeAutostart(true), platform: "linux", defaultOn: true, ...stored });

    await ask.noteChosen();

    expect(ask.shouldAsk()).toBe(false);
  });

  it("changes nothing on the platform until it is answered", () => {
    const autostart = fakeAutostart(false);
    createFirstRunAutostart({ autostart, platform: "linux", defaultOn: true, ...flag(false) }).shouldAsk();
    expect(autostart.calls).toEqual([]);
  });
});

describe("observeAutostart", () => {
  it("tells the listener after each change, once the change is made", async () => {
    const inner = fakeAutostart(false);
    const seen: boolean[] = [];
    const observed = observeAutostart(inner, async () => {
      seen.push(await inner.isEnabled());
    });

    await observed.set(true);
    await observed.disable();
    await observed.enable();

    expect(seen).toEqual([true, false, true]);
    expect(await observed.isEnabled()).toBe(true);
  });

  it("reads without telling anybody", async () => {
    let told = 0;
    await observeAutostart(fakeAutostart(true), () => {
      told += 1;
    }).isEnabled();
    expect(told).toBe(0);
  });
});
