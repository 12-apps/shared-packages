/**
 * What a host may need about superseded charges (FUT-4072): the mark a stored
 * row carries, the reasons, and the recorder contract. Listed here so the
 * package root stays inside its size gate.
 */
export type { SupersededCharge, SupersededRecorder } from './hosted-retire';
export { isSuperseded, type ChargeSupersession, type SupersededWhy, type VoidOutcome } from './supersession';
