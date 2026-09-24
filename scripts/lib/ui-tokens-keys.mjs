// The WORDS the ui-tokens scanner (`./ui-tokens-scan.mjs`) reads a style in:
// which keys hold lengths, which hold colours, what a hairline is, which names
// are counts rather than sizes. Kept apart from the checks so the list can be
// argued about on its own — each entry is a false positive or a false negative
// somebody measured (FUT-2585).

export const NAMED_COLORS = new Set([
  "white", "black", "red", "green", "blue", "yellow", "orange", "purple", "pink",
  "gray", "grey", "silver", "gold", "navy", "teal", "cyan", "magenta", "lime", "maroon", "olive",
]);
export const COLOR_KEY = /(color|colour|background|^bg$|bgcolor|fill|stroke|border|outline|shadow|caret|accent)/i;
export const HEX = /(^|[^\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])/;
export const COLOR_FN = /\b(?:rgba?|hsla?)\(/;
/** `sx`'s palette strings: `bgcolor: 'grey.100'`, `color: 'common.white'`. */
export const RAMP_STRING = /^(grey|common)\.\w+$/;
export const LENGTH = /(^|[^\w.$#-])(-?\d*\.?\d+)(px|rem|pt)\b/g;
export const FONT_KEY = /^(fontSize|font)$/;
export const BREAKPOINT_KEYS = new Set(["xs", "sm", "md", "lg", "xl"]);

export const SPACING_KEYS = new Set([
  "p", "pt", "pr", "pb", "pl", "px", "py", "m", "mt", "mr", "mb", "ml", "mx", "my",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "paddingX", "paddingY",
  "paddingInline", "paddingInlineStart", "paddingInlineEnd", "paddingBlock", "paddingBlockStart", "paddingBlockEnd",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "marginX", "marginY",
  "marginInline", "marginInlineStart", "marginInlineEnd", "marginBlock", "marginBlockStart", "marginBlockEnd",
  "gap", "rowGap", "columnGap",
]);
export const RADIUS_KEYS = /^border(Top|Bottom|Start|End)?(Left|Right|Start|End)?Radius$/;
export const BOX_KEYS = new Set(["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "flexBasis"]);
/** A border/outline WIDTH (or shorthand): the only place `1px` is a hairline rather than a length. */
export const HAIRLINE_KEY = /^((border|outline)(Top|Right|Bottom|Left|Block|Inline|BlockStart|BlockEnd|InlineStart|InlineEnd)?(Width)?|divider|stroke|strokeWidth|hairline)$/;
export const LENGTH_NAMED_KEY =
  /^(fontSize|top|left|right|bottom|inset|insetInline(Start|End)?|insetBlock(Start|End)?|letterSpacing|outlineOffset|textIndent|scrollMargin\w*|scrollPadding\w*|translate[XY]?|blur|spread)$|(Height|Width|Gap|Padding|Offset|Radius|Margin|Inset|Indent|Threshold|Spacing|Distance|Peek)$|^(height|width|gap|padding|offset|radius|margin|inset|indent|threshold|spacing)$|(icon|font|glyph|box|thumb|cell|dot|tile|avatar|spinner|button|handle|arrow|mark|badge|circle|step|indicator|swatch)Size$|^size$/;
export const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;
export const CONSTANT_LENGTH_WORD = /(HEIGHT|WIDTH|SIZE|GAP|PAD|PADDING|OFFSET|RADIUS|MARGIN|INSET|INDENT|_PX|THRESHOLD|SPACING|DISTANCE|PEEK|GUTTER)/;
/** Counts and times that merely share a word with a length: a page of 50 rows is not 50px. */
export const CONSTANT_NOT_LENGTH = /(PAGE_SIZE|BATCH|CHUNK|VIRTUALI[SZ]ATION_THRESHOLD|_COUNT|LIMIT|MAX_ITEMS|_MS$|DELAY|DURATION|DEBOUNCE|TIMEOUT|INTERVAL)/;
export const SVG_SHAPES = new Set([
  "rect", "circle", "ellipse", "line", "path", "polygon", "polyline", "g", "text", "tspan",
  "use", "image", "pattern", "mask", "clipPath", "defs", "linearGradient", "radialGradient", "stop", "foreignObject",
]);
export const JSX_SIZE_ATTRS = new Set(["size", "width", "height", "fontSize", "iconSize"]);
/** `size` on a grid is a COLUMN count, not a length. */
export const COLUMN_SIZED_TAGS = /^(Grid|Grid2|MuiGrid)$/;
/** The vocabulary: a call to one of these IS theme-relative. */
/** `fieldHeightPx` is NOT here: it converts against a fixed 16px, like the `px()` the gate forbids. */
export const VOCAB_CALL = /^(rem|rems|sxRem|remPx|fieldHeight|fieldHeightRem|fieldRadius|fieldRadiusPx|pxToRem|spacing)$/;
export const THEME_RELATIVE_MEMBER = /^(theme|t)\.(shape\.borderRadius|spacing)\b/;

