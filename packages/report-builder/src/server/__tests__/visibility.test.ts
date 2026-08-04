import { describe, expect, it } from 'vitest';

import { canViewSavedReport, visibilityRoleIds } from '../visibility';

const base = {
  status: 'published',
  visibility: 'tenant',
  visibilityRoles: [] as unknown,
  createdBy: 'author-1',
};

const author = { userId: 'author-1', isAdmin: false, roleIds: [] };
const admin = { userId: 'admin-1', isAdmin: true, roleIds: [] };
const staff = { userId: 'staff-1', isAdmin: false, roleIds: ['role-waiter'] };

describe('canViewSavedReport', () => {
  it('admins see everything, drafts included', () => {
    expect(canViewSavedReport({ ...base, status: 'draft', visibility: 'private' }, admin)).toBe(
      true,
    );
  });

  it('drafts are author-only beyond the admin tier', () => {
    const draft = { ...base, status: 'draft' };
    expect(canViewSavedReport(draft, author)).toBe(true);
    expect(canViewSavedReport(draft, staff)).toBe(false);
  });

  it('published tenant-wide documents reach every staff member', () => {
    expect(canViewSavedReport(base, staff)).toBe(true);
  });

  /**
   * FUT-391: archiving RETIRES a report. It stops being a team document the
   * moment it is archived — regardless of the sharing rule it was published
   * with — so only its author (and admins, who restore it) still reach it.
   */
  it('archived documents leave circulation, keeping author + admin access', () => {
    const archived = { ...base, status: 'archived' };
    expect(canViewSavedReport(archived, staff)).toBe(false);
    expect(canViewSavedReport(archived, author)).toBe(true);
    expect(canViewSavedReport(archived, admin)).toBe(true);
  });

  it('role-list visibility matches any held role id, plus the author', () => {
    const shared = { ...base, visibility: 'roles', visibilityRoles: ['role-waiter'] };
    expect(canViewSavedReport(shared, staff)).toBe(true);
    expect(canViewSavedReport(shared, { ...staff, roleIds: ['role-chef'] })).toBe(false);
    expect(canViewSavedReport(shared, author)).toBe(true);
  });

  it('private documents stay with the author and admins', () => {
    const secret = { ...base, visibility: 'private' };
    expect(canViewSavedReport(secret, author)).toBe(true);
    expect(canViewSavedReport(secret, staff)).toBe(false);
  });

  it('fails closed on unknown/corrupt values', () => {
    expect(canViewSavedReport({ ...base, visibility: 'everyone?' }, staff)).toBe(false);
    expect(
      canViewSavedReport({ ...base, visibility: 'roles', visibilityRoles: 'oops' }, staff),
    ).toBe(false);
    // A null-author record is never "authored" by an identity-less actor.
    expect(
      canViewSavedReport(
        { ...base, status: 'draft', createdBy: null },
        { userId: null, isAdmin: false, roleIds: [] },
      ),
    ).toBe(false);
  });
});

describe('visibilityRoleIds', () => {
  it('narrows the JSON column to string ids, dropping junk', () => {
    expect(visibilityRoleIds(['a', 1, null, 'b'])).toEqual(['a', 'b']);
    expect(visibilityRoleIds('not-an-array')).toEqual([]);
    expect(visibilityRoleIds(undefined)).toEqual([]);
  });
});
