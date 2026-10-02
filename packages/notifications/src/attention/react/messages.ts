/**
 * Every sentence the attention surface says, supplied by the HOST.
 *
 * There is no default table on purpose (the package's portability suite
 * forbids one): a second host that forgot a key must fail at compile time,
 * not inherit somebody else's language.
 */
import type { AttentionChannelLevel } from '../core';

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
  /** The "+N" read aloud. */
  readonly others: (count: number) => string;
  /** The list it opens. */
  readonly othersTitle: string;
  readonly preferences: AttentionPreferencesMessages;
}

export interface AttentionPreferencesMessages {
  readonly title: string;
  /** The compact control's accessible name. */
  readonly quickLabel: string;
  readonly sound: string;
  readonly vibration: string;
  readonly push: string;
  readonly levels: Readonly<Record<AttentionChannelLevel, string>>;
  readonly levelHints?: Readonly<Record<AttentionChannelLevel, string>>;
  readonly vibrationUnavailable: string;
  readonly pushHint?: string;
  readonly pushEnable: string;
  readonly pushUnavailable: string;
  readonly testSound: string;
  readonly testVibration: string;
  readonly position: string;
  readonly positionMoved: string;
  readonly positionResting: string;
  readonly resetPosition: string;
}
