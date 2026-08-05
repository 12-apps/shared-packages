/**
 * Comprehensive HTML entity decoder
 * Handles both named entities (&nbsp;, &amp;, etc.) and numeric entities (&#39;, &#x27;, etc.)
 */
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#039;': "'",
  '&#x27;': "'",
  '&#39;': "'",
  '&ldquo;': '"',
  '&rdquo;': '"',
  '&lsquo;': "'",
  '&rsquo;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&bull;': '•',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
};

function decodeHTMLEntities(text: string): string {
  // Replace named entities
  Object.entries(HTML_ENTITIES).forEach(([entity, char]) => {
    text = text.replace(new RegExp(entity, 'g'), char);
  });

  // Replace numeric entities (&#123; or &#xAB;)
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)));
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));

  return text;
}

/**
 * Strips HTML tags and decodes HTML entities from text
 * More efficient and comprehensive than manual regex replacements
 *
 * @param html - HTML string to clean
 * @param options - Configuration options
 * @returns Plain text with HTML removed and entities decoded
 */
// Removes every <tag>…</tag> span, case-insensitively, by scanning rather than
// by regex. A regex here is wrong three ways: /<\/script>/ misses `</script >`,
// a single pass can leave a partial `<script` behind when spans overlap, and
// `<style[^>]*>` backtracks polynomially on input full of `<style`.
const removeSpans = (text: string, tag: string): string => {
  const lower = text.toLowerCase();
  const open = `<${tag}`;
  let out = '';
  let cursor = 0;

  for (;;) {
    const start = lower.indexOf(open, cursor);
    if (start === -1) return out + text.slice(cursor);

    out += text.slice(cursor, start);

    const close = lower.indexOf(`</${tag}`, start);
    // Unterminated: the rest of the document is inside the element.
    if (close === -1) return out;

    const end = text.indexOf('>', close);
    if (end === -1) return out;
    cursor = end + 1;
  }
};

const removeComments = (text: string): string => {
  let out = '';
  let cursor = 0;

  for (;;) {
    const start = text.indexOf('<!--', cursor);
    if (start === -1) return out + text.slice(cursor);

    out += text.slice(cursor, start);

    const end = text.indexOf('-->', start);
    if (end === -1) return out;
    cursor = end + 3;
  }
};

// Style, script and comment blocks go entirely — their contents are not text.
const removeNonTextBlocks = (text: string): string =>
  removeComments(removeSpans(removeSpans(text, 'style'), 'script'));

// Turn the block-level tags into the breaks they imply, before all tags go.
const tagsToLineBreaks = (text: string): string =>
  text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n');

// Removes every <…> run in one left-to-right pass. A regex is wrong twice here:
// /<[^>]*>/g rescans from every '<' on input that has no '>', which is
// quadratic, and one pass of it can splice neighbours into a fresh tag
// ("<<a>script>"). Scanning drops every '<' and everything through its '>', so
// nothing survives to be reassembled and an unterminated tag takes the rest of
// the string with it.
const stripTags = (text: string): string => {
  let out = '';
  let inTag = false;

  for (const char of text) {
    if (char === '<') {
      inTag = true;
    } else if (char === '>') {
      inTag = false;
    } else if (!inTag) {
      out += char;
    }
  }

  return out;
};

const truncate = (text: string, maxLength?: number): string =>
  maxLength && text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;

const collapseWhitespace = (text: string, preserveLineBreaks: boolean): string =>
  preserveLineBreaks
    ? text
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim()
    : text
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export function stripHTML(
  html: string | null | undefined,
  options?: {
    maxLength?: number;
    preserveLineBreaks?: boolean;
    fallback?: string;
  },
): string {
  if (!html) {
    return options?.fallback ?? '';
  }

  const preserveLineBreaks = Boolean(options?.preserveLineBreaks);
  let text = removeNonTextBlocks(html);

  if (preserveLineBreaks) {
    text = tagsToLineBreaks(text);
  }

  text = decodeHTMLEntities(stripTags(text));
  text = collapseWhitespace(text, preserveLineBreaks);

  text = truncate(text, options?.maxLength);

  return text || options?.fallback || '';
}
