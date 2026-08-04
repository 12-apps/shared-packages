import { describe, it, expect } from 'vitest';
import { stripHTML } from '../src/utils/lib/stripHtml';

// These cover the ways a regex-based stripper gets HTML wrong: an end tag with
// trailing whitespace, mixed case, and removals that splice their neighbours
// into a fresh tag.
describe('stripHTML security', () => {
  it.each([
    ['<script>alert(1)</script>hello', 'hello'],
    ['<script>alert(1)</script >hello', 'hello'],
    ['<SCRIPT>x</SCRIPT>ok', 'ok'],
    ['<style>a{}</style>text', 'text'],
    ['<!-- c -->visible', 'visible'],
    // Without preserveLineBreaks the tags simply vanish, no separator inserted.
    ['<p>one</p><p>two</p>', 'onetwo'],
    ['plain', 'plain'],
  ])('strips %j', (input, want) => {
    expect(stripHTML(input)).toBe(want);
  });

  it('leaves no tag behind when removal splices neighbours together', () => {
    expect(stripHTML('<<a>script>payload')).not.toContain('<script');
  });

  it('preserves line breaks when asked', () => {
    expect(stripHTML('<p>one</p><p>two</p>', { preserveLineBreaks: true })).toBe('one\n\ntwo');
  });
});
