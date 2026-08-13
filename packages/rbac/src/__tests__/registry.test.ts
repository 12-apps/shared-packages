import { describe, it, expect } from 'vitest';
import { definePermissions } from '../core/registry';

describe('definePermissions', () => {
  it('exposes the list contents in order', () => {
    const reg = definePermissions(['posts:read', 'posts:write'] as const);
    expect(reg.list).toEqual(['posts:read', 'posts:write']);
  });

  it('has() returns true for registered permissions', () => {
    const reg = definePermissions(['posts:read', 'posts:write'] as const);
    expect(reg.has('posts:read')).toBe(true);
    expect(reg.has('posts:write')).toBe(true);
  });

  it('has() returns false for unregistered permissions', () => {
    const reg = definePermissions(['posts:read', 'posts:write'] as const);
    expect(reg.has('posts:delete')).toBe(false);
    expect(reg.has('')).toBe(false);
  });

  it('acts as a type guard narrowing string to the union', () => {
    const reg = definePermissions(['posts:read', 'posts:write'] as const);
    const candidate: string = 'posts:read';
    if (reg.has(candidate)) {
      // Compile-time proof: narrowed value is assignable to the union.
      const narrowed: 'posts:read' | 'posts:write' = candidate;
      expect(narrowed).toBe('posts:read');
    } else {
      throw new Error('expected has() to narrow');
    }
  });

  it('defaults every permission to class kind for the array form', () => {
    const reg = definePermissions(['posts:read', 'posts:write'] as const);
    expect(reg.kind('posts:read')).toBe('class');
    expect(reg.kind('posts:write')).toBe('class');
  });
});

describe('definePermissions — object-map form', () => {
  function mk() {
    return definePermissions({
      'loans:read:own': 'instance',
      'titles:write': 'class',
    } as const);
  }

  it('derives the list from the map keys', () => {
    const reg = mk();
    expect([...reg.list].sort()).toEqual(['loans:read:own', 'titles:write']);
  });

  it('has() reflects the declared keys', () => {
    const reg = mk();
    expect(reg.has('loans:read:own')).toBe(true);
    expect(reg.has('nope')).toBe(false);
  });

  it('kind() reports the declared scope-kind', () => {
    const reg = mk();
    expect(reg.kind('loans:read:own')).toBe('instance');
    expect(reg.kind('titles:write')).toBe('class');
  });

  it('kind() defaults unknown permissions to class', () => {
    const reg = mk();
    expect(reg.kind('made:up')).toBe('class');
  });
});
