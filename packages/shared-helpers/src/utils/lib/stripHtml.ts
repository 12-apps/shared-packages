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
// Style, script and comment blocks go entirely — their contents are not text.
const removeNonTextBlocks = (text: string): string =>
  text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

// Turn the block-level tags into the breaks they imply, before all tags go.
const tagsToLineBreaks = (text: string): string =>
  text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n');

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

  text = decodeHTMLEntities(text.replace(/<[^>]*>/g, ''));
  text = collapseWhitespace(text, preserveLineBreaks);

  text = truncate(text, options?.maxLength);

  return text || options?.fallback || '';
}
