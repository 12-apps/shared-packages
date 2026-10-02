/**
 * Sound and vibration when something NEW needs the reader — an item that
 * arrived, or one that became more urgent. Never on a timer, never for what was
 * already on screen when the page opened, and only as loud as the device's own
 * settings allow (`./preferences.ts`).
 *
 * ## Why the tones are synthesised
 *
 * A sound file is somebody's brand; two short tone patterns are not, and they
 * need no asset path the host would have to serve. A host that wants its own
 * sounds passes their URLs.
 *
 * ## What the platform allows
 *
 * - **Sound** needs a user gesture first (autoplay policy; Safari holds it per
 *   audio context). `useAttentionAlerts` listens for the page's first tap or
 *   key press, resumes the shared context and primes the host's files there,
 *   so a later announcement — which never comes from a gesture — can play.
 *   Before that first gesture, the call is a silent no-op: the button still
 *   says it.
 * - **Vibration** is `navigator.vibrate`: Chrome on Android. Safari on iPhone
 *   — and so every browser there — does not implement it, and desktops have
 *   nothing to shake. `canVibrate()` is what the settings read to say so.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

import {
  announcementBetween,
  channelWants,
  snapshotOf,
  type AttentionEntry,
  type AttentionSeverity,
  type AttentionSnapshot,
} from '../core';

import type { AttentionPreferences } from './preferences';

/** Optional sound files, one per loudness; the synthesised tones stand in for any left out. */
export interface AttentionSounds {
  readonly urgent?: string;
  readonly calm?: string;
}

type Tone = readonly [hz: number, atSeconds: number];

const URGENT_TONES: readonly Tone[] = [
  [988, 0],
  [988, 0.22],
  [784, 0.44],
];
const CALM_TONES: readonly Tone[] = [
  [660, 0],
  [880, 0.16],
];

const URGENT_BUZZ = [300, 120, 300, 120, 300];
const CALM_BUZZ = [120];

interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNode;
  readonly state: string;
  resume(): Promise<void>;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

let sharedContext: AudioContextLike | null = null;

function audioContext(): AudioContextLike | null {
  if (sharedContext !== null) return sharedContext;
  if (typeof window === 'undefined') return null;
  const Ctor =
    (window as unknown as { AudioContext?: new () => AudioContextLike }).AudioContext ??
    (window as unknown as { webkitAudioContext?: new () => AudioContextLike }).webkitAudioContext;
  if (Ctor === undefined) return null;
  try {
    sharedContext = new Ctor();
  } catch {
    return null;
  }
  return sharedContext;
}

function playTones(urgent: boolean): void {
  const context = audioContext();
  if (context === null) return;
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  for (const [hz, at] of urgent ? URGENT_TONES : CALM_TONES) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = urgent ? 'square' : 'sine';
    oscillator.frequency.value = hz;
    const start = context.currentTime + at;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(urgent ? 0.12 : 0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  }
}

/** The host's files, primed inside a gesture so they may play later. */
const primed = new Map<string, HTMLAudioElement>();

/** How often a file that will not play is tried before it is given up on. */
const PRIME_ATTEMPTS = 3;
const attempts = new Map<string, number>();

function prime(url: string): void {
  if (primed.has(url) || typeof Audio === 'undefined') return;
  const tried = attempts.get(url) ?? 0;
  if (tried >= PRIME_ATTEMPTS) return;
  attempts.set(url, tried + 1);
  const element = new Audio(url);
  element.muted = true;
  primed.set(url, element);
  void element
    .play()
    .then(() => {
      element.pause();
      element.currentTime = 0;
      element.muted = false;
    })
    .catch(() => {
      // Not a gesture after all: forget it, so the next gesture primes again.
      primed.delete(url);
    });
}

/** Has the page's audio been woken up by a gesture yet? */
function audioUnlocked(sounds?: AttentionSounds): boolean {
  const context = sharedContext;
  const toneReady = context === null || context.state === 'running';
  const filesReady = [sounds?.urgent, sounds?.calm].every(
    (url) => url === undefined || primed.has(url) || (attempts.get(url) ?? 0) >= PRIME_ATTEMPTS,
  );
  return toneReady && filesReady;
}

/**
 * Called from inside a user gesture: wakes the shared audio context and primes
 * the host's sound files. Safe to call more than once.
 */
export function unlockAttentionAudio(sounds?: AttentionSounds): void {
  try {
    const context = audioContext();
    if (context !== null && context.state === 'suspended') void context.resume().catch(() => undefined);
    if (sounds?.urgent !== undefined) prime(sounds.urgent);
    if (sounds?.calm !== undefined) prime(sounds.calm);
  } catch {
    // Nothing to unlock here: the button still says it.
  }
}

/** Play the sound for this loudness. Silent where the page may not play yet. */
export function playAttentionSound(severity: AttentionSeverity, sounds?: AttentionSounds): void {
  const urgent = severity !== 'calm';
  const url = urgent ? sounds?.urgent : sounds?.calm;
  try {
    if (url !== undefined && typeof Audio !== 'undefined') {
      const element = primed.get(url) ?? new Audio(url);
      element.currentTime = 0;
      void element.play().catch(() => undefined);
      return;
    }
    playTones(urgent);
  } catch {
    // Nothing to play on: the button still says it.
  }
}

/** Can this device vibrate from a web page? */
export function canVibrate(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  // A desktop browser may expose the call with nothing to shake.
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
}

const noSubscription = (): (() => void) => () => undefined;

/** `canVibrate()` for a render: false on the server and in the first paint's hydration. */
export function useCanVibrate(): boolean {
  return useSyncExternalStore(noSubscription, canVibrate, () => false);
}

export function vibrateFor(severity: AttentionSeverity): void {
  try {
    if (canVibrate()) navigator.vibrate(severity === 'calm' ? CALM_BUZZ : URGENT_BUZZ);
  } catch {
    // Refused (no user gesture yet): the button still says it.
  }
}

/**
 * The events that count as a user gesture. A TOUCH `pointerdown` is not one —
 * on iPhone only the end of the touch is — so every candidate is listened to,
 * and the listeners stay until the audio is actually running.
 */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

/** Unlock audio on the page's first real gesture. */
function useAudioUnlock(sounds: AttentionSounds | undefined): void {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const detach = (): void => {
      for (const type of GESTURES) window.removeEventListener(type, unlock, true);
    };
    const unlock = (event: Event): void => {
      // A touch's START is not a gesture on iPhone: priming then would succeed
      // muted and never be repeated inside the gesture that follows.
      if (event.type === 'pointerdown' && (event as PointerEvent).pointerType !== 'mouse') return;
      unlockAttentionAudio(sounds);
      // `resume()` and `play()` settle asynchronously: check after they do.
      window.setTimeout(() => {
        if (audioUnlocked(sounds)) detach();
      }, 250);
    };
    for (const type of GESTURES) window.addEventListener(type, unlock, true);
    return detach;
  }, [sounds]);
}

/**
 * Ring and buzz for each new arrival or escalation, as the device's settings
 * allow. Readings taken while `ready` is false — the host still loading — only
 * move the baseline, so what was already waiting when the page opened never
 * rings.
 */
export function useAttentionAlerts(
  entries: readonly AttentionEntry[],
  preferences: Pick<AttentionPreferences, 'sound' | 'vibration'>,
  sounds?: AttentionSounds,
  ready = true,
): void {
  useAudioUnlock(sounds);
  const seen = useRef<AttentionSnapshot | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = snapshotOf(entries);
    if (before === null || !ready) {
      if (!ready) seen.current = null;
      return;
    }
    const news = announcementBetween(before, entries);
    if (news === null) return;
    if (channelWants(preferences.sound, news.severity)) playAttentionSound(news.severity, sounds);
    if (channelWants(preferences.vibration, news.severity)) vibrateFor(news.severity);
  }, [entries, preferences.sound, preferences.vibration, sounds, ready]);
}
