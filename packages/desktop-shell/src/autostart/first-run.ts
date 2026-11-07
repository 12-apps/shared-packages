import type { Autostart } from "./index";

/**
 * "Start with the machine?" — asked ONCE, on the app's first-time setup.
 *
 * Which answer is right depends on the app, so the app supplies its default:
 * a background agent that should be printing before anybody opens it
 * defaults to yes, a window somebody opens to work in defaults to no. What is
 * the same for every app lives here:
 *
 * - **Asked once.** The host keeps one stored flag, "this install already
 *   chose", and this reads and sets it. An install that chose before — on an
 *   earlier version, from the tray, from a settings checkbox — is never
 *   asked, and its autostart is left exactly as it is.
 * - **The answer is applied and read back.** Every platform can refuse
 *   silently (a policy, a read-only home), so the step learns what actually
 *   happened rather than what was asked for.
 * - **Only where the question means something.** Windows and Linux; on any
 *   other platform nothing is asked and nothing is changed.
 *
 * Framework-free: the app draws the step in its own first-time flow, with
 * its own words, and calls {@link FirstRunAutostart.answer} from its button.
 */

/** The platforms the step asks on (`process.platform`). */
const ASKING_PLATFORMS: ReadonlySet<string> = new Set(["linux", "win32"]);

export interface FirstRunAutostartOptions {
  /** The shell's autostart (or any port with the same two calls). */
  autostart: Pick<Autostart, "set" | "isEnabled">;
  /** `process.platform`. */
  platform: string;
  /** What the step preselects, and so what one tap on its confirm button keeps. The APP's call. */
  defaultOn: boolean;
  /** Whether this install already chose — the host's stored flag, read live. */
  chosen: () => boolean;
  /** Store "this install chose". Called once the answer is applied. */
  remember: () => Promise<void>;
}

export interface FirstRunAutostart {
  /** Whether the first-time setup should still show the step. */
  shouldAsk(): boolean;
  /** The option the step preselects: the app's default. */
  readonly preselected: boolean;
  /**
   * Apply the person's answer and remember the install chose. Resolves to
   * what the platform reports AFTER the change, which a screen should show.
   */
  answer(next: boolean): Promise<boolean>;
  /**
   * The person changed autostart somewhere else (the tray's checkbox, a
   * settings page) before answering: that is a choice too, so the step is
   * not shown after it.
   */
  noteChosen(): Promise<void>;
}

export function createFirstRunAutostart(options: FirstRunAutostartOptions): FirstRunAutostart {
  const asks = ASKING_PLATFORMS.has(options.platform);
  const noteChosen = async (): Promise<void> => {
    if (!options.chosen()) await options.remember();
  };
  return {
    shouldAsk: () => asks && !options.chosen(),
    preselected: options.defaultOn,
    answer: async (next) => {
      await options.autostart.set(next);
      const now = await options.autostart.isEnabled();
      await noteChosen();
      return now;
    },
    noteChosen,
  };
}

/**
 * The autostart, telling `onChange` after every change made through it.
 *
 * The shell hands the host this wrapper, so a change the host makes — the
 * first-time step's answer, a settings checkbox — reaches the tray's
 * "start with the machine" entry, which otherwise kept the value it read when
 * it was built.
 */
export function observeAutostart(autostart: Autostart, onChange: () => void | Promise<void>): Autostart {
  const after =
    <A extends unknown[]>(call: (...args: A) => Promise<void>) =>
    async (...args: A): Promise<void> => {
      await call(...args);
      await onChange();
    };
  return {
    isEnabled: () => autostart.isEnabled(),
    enable: after(() => autostart.enable()),
    disable: after(() => autostart.disable()),
    set: after((next: boolean) => autostart.set(next)),
  };
}
