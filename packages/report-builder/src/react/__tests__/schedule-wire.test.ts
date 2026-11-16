import { describe, expect, it } from 'vitest';

import { draftFromWire, wireFromDraft, type ScheduleDraft } from '../lib/schedule-draft';
import { editorSource } from '../report-editor-source';
import { documentGuardError } from '../report-editor-writes';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';
import { PT_BR_REPORT_SCHEDULE_COPY } from '../pt-BR.schedule';
import type { SavedReportView } from '../custom-reports-api';

const DRAFT: ScheduleDraft = {
  enabled: true,
  cadence: 'weekly',
  weekday: 3,
  dayOfMonth: 15,
  time: '09:30',
  recipients: ['u1'],
};

describe('wireFromDraft / draftFromWire (FUT-776)', () => {
  it('sends only the day the cadence reads', () => {
    expect(wireFromDraft(DRAFT)).toEqual({ enabled: true, cadence: 'weekly', weekday: 3, time: '09:30', recipients: ['u1'] });
    expect(wireFromDraft({ ...DRAFT, cadence: 'biweekly' })).toHaveProperty('weekday', 3);
    expect(wireFromDraft({ ...DRAFT, cadence: 'monthly' })).toEqual({
      enabled: true,
      cadence: 'monthly',
      dayOfMonth: 15,
      time: '09:30',
      recipients: ['u1'],
    });
    expect(wireFromDraft({ ...DRAFT, cadence: 'daily' })).not.toHaveProperty('weekday');
  });

  it('no draft is no schedule, which removes a stored one', () => {
    expect(wireFromDraft(null)).toBeNull();
    expect(draftFromWire(null)).toBeNull();
    expect(draftFromWire(undefined)).toBeNull();
  });

  it('round-trips through the wire, filling the day the cadence ignored', () => {
    const wire = wireFromDraft({ ...DRAFT, cadence: 'monthly' });
    expect(draftFromWire(wire)).toMatchObject({ cadence: 'monthly', dayOfMonth: 15, weekday: 1 });
  });
});

describe('the editor source carries the schedule', () => {
  const view = {
    id: 'r1',
    type: 'report',
    name: 'Vendas',
    description: null,
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
    defaultRange: '30d',
    schedule: { ...wireFromDraft(DRAFT), timeZone: 'America/Sao_Paulo', startsOn: '2026-11-16' },
    spec: { kind: 'dashboard', blocks: [] },
  } as unknown as SavedReportView;

  it('opens on the stored schedule', () => {
    expect(editorSource(view).initial.schedule).toMatchObject({ enabled: true, weekday: 3, recipients: ['u1'] });
  });

  it('resumes a parked edit that removed it, and one that never touched it', () => {
    const base = { name: 'Vendas', spec: { kind: 'dashboard', blocks: [] } };
    const removed = { ...view, workingCopy: { ...base, schedule: null } } as unknown as SavedReportView;
    const untouched = { ...view, workingCopy: base } as unknown as SavedReportView;
    expect(editorSource(removed).initial.schedule).toBeNull();
    expect(editorSource(untouched).initial.schedule).toMatchObject({ cadence: 'weekly' });
  });

  it('a report with no schedule opens with none', () => {
    expect(editorSource({ ...view, schedule: null }).initial.schedule).toBeNull();
    expect(editorSource(undefined).initial.schedule).toBeNull();
  });
});

describe('documentGuardError for the schedule', () => {
  const state = (schedule: ScheduleDraft | null) => {
    const source = editorSource(undefined).initial;
    return {
      ...source,
      draft: { ...source.draft, name: 'Vendas', blocks: [{ id: 'b', spec: {} }] as never },
      publish: { status: 'published' as const, visibility: 'tenant' as const, visibilityRoles: [] },
      schedule,
    };
  };
  const { builder } = PT_BR_REPORT_SCREENS_COPY;
  const editor = { ...PT_BR_REPORT_SCREENS_COPY.editor, needsRecipient: PT_BR_REPORT_SCHEDULE_COPY.needsRecipient };

  it('holds a save that would switch delivery on for nobody', () => {
    expect(documentGuardError(state({ ...DRAFT, recipients: [] }), editor, builder)).toBe(editor.needsRecipient);
  });

  it('lets a switched-off or populated schedule through', () => {
    expect(documentGuardError(state({ ...DRAFT, enabled: false, recipients: [] }), editor, builder)).toBeNull();
    expect(documentGuardError(state(DRAFT), editor, builder)).toBeNull();
    expect(documentGuardError(state(null), editor, builder)).toBeNull();
  });
});
