/**
 * Every sentence the attention surface says, supplied by the HOST.
 *
 * There is no default table on purpose (`attention/__tests__/portability`
 * holds the line): a second host that forgot a key must fail at compile time,
 * not inherit somebody else's language.
 */
import type { AttentionChannelLevel, AttentionSeverity } from '../core';

export interface AttentionMessages {
  /** A wait, short enough for the button: "7 min". */
  readonly waited: (minutes: number) => string;
  /** The button read aloud. */
  readonly button: (input: {
    readonly title: string;
    readonly what: string;
    readonly waited: string;
    readonly urgent: boolean;
    readonly others: number;
  }) => string;
  /** The "+N" read aloud, with the worst of them. */
  readonly others: (count: number, worst: AttentionSeverity) => string;
  /** A severity in words, for whoever cannot see the colour: "late". */
  readonly severity: Readonly<Record<AttentionSeverity, string>>;
  /** The list it opens. */
  readonly othersTitle: string;
  readonly preferences: AttentionPreferencesMessages;
}

/** One channel's words: its heading in the panel and in the compact control, and each level's. */
export interface AttentionChannelMessages {
  /** The panel's heading: "Sound of the alerts". */
  readonly title: string;
  /** The compact control's heading: "Sound". */
  readonly shortTitle: string;
  /** One sentence under the panel's heading. */
  readonly description: string;
  readonly levels: Readonly<Record<AttentionChannelLevel, string>>;
  /** Under each level, in the panel only. */
  readonly hints: Readonly<Record<AttentionChannelLevel, string>>;
}

export interface AttentionPreferencesMessages {
  /** The compact control's accessible name. */
  readonly quickLabel: string;
  readonly sound: AttentionChannelMessages & { readonly test: string };
  readonly vibration: AttentionChannelMessages & {
    readonly test: string;
    /** Under the panel's choices, where the device cannot vibrate. */
    readonly unavailable: string;
    /** The same, in the compact control. */
    readonly unavailableShort: string;
  };
  readonly push: AttentionChannelMessages & {
    readonly enable: string;
    readonly test: string;
    readonly unavailable: string;
  };
  readonly position: {
    readonly title: string;
    readonly moved: string;
    readonly resting: string;
    readonly reset: string;
  };
}
