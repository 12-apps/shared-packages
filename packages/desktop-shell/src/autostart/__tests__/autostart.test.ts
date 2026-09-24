import { describe, expect, it, vi } from "vitest";

import {
  autostartFilePath,
  createAutostart,
  desktopEntryFile,
  quoteExecArgument,
  type FilePort,
  type LoginItemPort,
} from "../index";

describe("desktopEntryFile", () => {
  it("quotes a path with a space, which is the case that breaks a session", () => {
    // Unquoted, the desktop environment starts `/home/maria` and reports
    // nothing at all.
    expect(quoteExecArgument("/home/maria da silva/agent")).toBe('"/home/maria da silva/agent"');
  });

  it("escapes the characters the spec reserves inside quotes", () => {
    expect(quoteExecArgument('a"b$c`d\\e')).toBe('"a\\"b\\$c\\`d\\\\e"');
  });

  it("switches the entry ON — Hidden=true would mean the opposite", () => {
    const file = desktopEntryFile({ name: "Agent", exec: "/opt/agent" });
    expect(file).toContain("Hidden=false");
    expect(file).toContain("X-GNOME-Autostart-enabled=true");
    expect(file).toContain("Terminal=false");
  });

  it("carries the background argument into Exec", () => {
    expect(desktopEntryFile({ name: "Agent", exec: "/opt/agent", args: ["--background"] })).toContain(
      'Exec="/opt/agent" "--background"',
    );
  });

  it("refuses to let a host's string append keys of its own", () => {
    // The name is host copy, and a host that interpolates something somebody
    // typed has handed this function a newline.
    const file = desktopEntryFile({ name: "Agent\nExec=/bin/sh", exec: "/opt/agent" });
    expect(file).toContain("Name=Agent Exec=/bin/sh");
    expect(file.match(/^Exec=/gm)).toHaveLength(1);
  });
});

describe("autostartFilePath", () => {
  it("honours XDG_CONFIG_HOME when the machine sets one", () => {
    expect(autostartFilePath("app.agent", { XDG_CONFIG_HOME: "/cfg", HOME: "/home/x" })).toBe(
      "/cfg/autostart/app.agent.desktop",
    );
  });

  it("falls back to ~/.config, the spec's default", () => {
    expect(autostartFilePath("app.agent", { HOME: "/home/x" })).toBe(
      "/home/x/.config/autostart/app.agent.desktop",
    );
  });

  it("takes `process.env` itself — the call every host actually makes", () => {
    const path = autostartFilePath("app.agent", process.env);
    expect(path).toMatch(/\/autostart\/app\.agent\.desktop$/);
  });

  it("takes an environment that declares a key of its own", () => {
    // A compile-time assertion wearing a runtime test, and the one that
    // matters. `AutostartEnv` was once spelled
    // `{ XDG_CONFIG_HOME?: string; HOME?: string }` — a WEAK type, which
    // TypeScript refuses an argument that shares none of its properties. An
    // index signature alone is forgiven; an index signature plus ONE declared
    // key is not, and that is exactly `@types/node`'s `ProcessEnv` up to
    // 22.19.x, where it carried `TZ?: string`. So 1.0.0 typechecked here, on
    // 22.20.1 where `ProcessEnv extends Dict<string> {}` and declares
    // nothing, and failed in the first host that had the older types.
    //
    // Hence the local shape rather than `process.env` above: this case fails
    // `check-types` if the parameter is ever narrowed again, on any version
    // of `@types/node` that happens to be installed.
    const env: WeakTypeTrap = { HOME: "/home/x" };
    expect(autostartFilePath("app.agent", env)).toBe(
      "/home/x/.config/autostart/app.agent.desktop",
    );
  });
});

/** `@types/node` 22.19.x's `ProcessEnv`, reduced to what makes it a trap. */
interface WeakTypeTrap {
  [key: string]: string | undefined;
  TZ?: string;
}

/** An in-memory stand-in for the Linux half's file system. */
function memoryFiles(): FilePort & { readonly written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    exists: (path) => Promise.resolve(written.has(path)),
    write: (path, content) => {
      written.set(path, content);
      return Promise.resolve();
    },
    remove: (path) => {
      written.delete(path);
      return Promise.resolve();
    },
  };
}

describe("createAutostart", () => {
  it("writes and removes the desktop file on linux", async () => {
    const files = memoryFiles();
    const autostart = createAutostart({
      platform: "linux",
      id: "app.agent",
      entry: { name: "Agent", exec: "/opt/agent" },
      backgroundArgs: ["--background"],
      files,
      env: { HOME: "/home/x" },
    });

    expect(await autostart.isEnabled()).toBe(false);
    await autostart.enable();
    expect(await autostart.isEnabled()).toBe(true);
    expect(files.written.get("/home/x/.config/autostart/app.agent.desktop")).toContain(
      'Exec="/opt/agent" "--background"',
    );

    await autostart.disable();
    expect(await autostart.isEnabled()).toBe(false);
  });

  it("uses the login item on macOS and Windows, hidden and with the flag", async () => {
    const calls: unknown[] = [];
    const loginItem: LoginItemPort = {
      getLoginItemSettings: () => ({ openAtLogin: calls.length % 2 === 1 }),
      setLoginItemSettings: (settings) => calls.push(settings),
    };
    const autostart = createAutostart({
      platform: "darwin",
      id: "app.agent",
      entry: { name: "Agent", exec: "/Applications/Agent.app" },
      backgroundArgs: ["--background"],
      loginItem,
    });

    await autostart.enable();
    expect(calls[0]).toEqual({ openAtLogin: true, openAsHidden: true, args: ["--background"] });
    expect(await autostart.isEnabled()).toBe(true);
  });

  it("clears the arguments when disabling, so nothing points at a replaced build", async () => {
    const setSettings = vi.fn();
    const autostart = createAutostart({
      platform: "win32",
      id: "app.agent",
      entry: { name: "Agent", exec: "C:/agent.exe" },
      backgroundArgs: ["--background"],
      loginItem: { getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings: setSettings },
    });

    await autostart.disable();
    expect(setSettings).toHaveBeenCalledWith({ openAtLogin: false, args: [] });
  });

  it("reads the Windows login item with the arguments it was written with", async () => {
    // Windows matches the `Run` value on its arguments too, so this fake
    // answers only when the read carries what the write stored. A read that
    // passes nothing looks for a different entry and reports OFF with
    // autostart plainly on — which the settings checkbox then mirrors, so it
    // is born unchecked and snaps back the moment somebody clicks it.
    let stored: readonly string[] | null = null;
    const loginItem: LoginItemPort = {
      setLoginItemSettings: (settings) => {
        stored = settings.openAtLogin ? (settings.args ?? []) : null;
      },
      getLoginItemSettings: (identity) => ({
        openAtLogin:
          stored !== null && (identity?.args ?? []).join("\u0000") === stored.join("\u0000"),
      }),
    };

    const autostart = createAutostart({
      platform: "win32",
      id: "app.agent",
      entry: { name: "Agent", exec: "C:/agent.exe" },
      backgroundArgs: ["--background"],
      loginItem,
    });

    await autostart.enable();
    expect(await autostart.isEnabled()).toBe(true);

    await autostart.disable();
    expect(await autostart.isEnabled()).toBe(false);
  });

  it("answers off and changes nothing when the platform's port was not supplied", async () => {
    const autostart = createAutostart({
      platform: "linux",
      id: "app.agent",
      entry: { name: "Agent", exec: "/opt/agent" },
    });
    await autostart.enable();
    expect(await autostart.isEnabled()).toBe(false);
  });
});
