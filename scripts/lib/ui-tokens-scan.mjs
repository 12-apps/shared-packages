// The SCANNER half of the ui-tokens gate (FUT-2585): which files are in scope,
// and what counts as a raw size or colour in one of them. The ledger and the
// ratchet are in `scripts/ui-tokens-gate.mjs`; the argument for the whole thing
// is at the top of that file.
//
// Read with the TypeScript AST plus a type checker, never a regex over the
// text: `sx={{ gap: 1 }}` is one spacing unit (relative) and
// `styled('div')({ gap: 1 })` is one pixel (raw), and a number reached through
// a name (`height: metrics.height`) is where most of the package's sizes live.
import ts from "typescript";

import {
  NAMED_COLORS,
  COLOR_KEY,
  HEX,
  COLOR_FN,
  RAMP_STRING,
  LENGTH,
  FONT_KEY,
  BREAKPOINT_KEYS,
  SPACING_KEYS,
  RADIUS_KEYS,
  BOX_KEYS,
  HAIRLINE_KEY,
  LENGTH_NAMED_KEY,
  CONSTANT_NAME,
  CONSTANT_LENGTH_WORD,
  CONSTANT_NOT_LENGTH,
  SVG_SHAPES,
  JSX_SIZE_ATTRS,
  COLUMN_SIZED_TAGS,
} from "./ui-tokens-keys.mjs";
import { isHairlineName, isPxSafe, isRelative, unwrap } from "./ui-tokens-relative.mjs";


export const RULES = [
  "raw-color", "palette-ramp", "raw-font-size", "raw-length",
  "raw-number-length", "raw-jsx-size", "px-helper", "layout-constant",
];

function propName(node) {
  const n = node?.name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return null;
}

/** A numeric literal (negative included, through any wrapper), or null. */
function numericValue(expr) {
  const e = unwrap(expr);
  if (!e) return null;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  const isNegative = ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken;
  return isNegative && ts.isNumericLiteral(e.operand) ? -Number(e.operand.text) : null;
}

/** Nodes a style VALUE passes through on its way up to the key it belongs to. */
function isValueWrapper(p) {
  return ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p) || ts.isBinaryExpression(p) ||
    ts.isTemplateSpan(p) || ts.isTemplateExpression(p) || ts.isArrayLiteralExpression(p) || ts.isAsExpression(p);
}

/**
 * The CSS key a value (or a property) belongs to, looking through `? :`, `??`,
 * templates, and MUI's responsive shapes — `{ md: 168 }` and `[40, 60]` are
 * still `minWidth`'s values.
 */
const isProperty = (p) => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p);

/** One step up: `{ next }` to keep climbing, `{ key }` when the owning key is found. */
function keyStep(p) {
  if (isValueWrapper(p)) return { next: p.parent };
  if (ts.isJsxAttribute(p)) return { key: p.name.getText() };
  if (!isProperty(p)) return { key: "" };
  const key = propName(p) ?? "";
  // A breakpoint object's key: climb to the property that holds the object.
  return BREAKPOINT_KEYS.has(key) ? { next: p.parent?.parent } : { key };
}

function styleKeyOf(node) {
  let p = isProperty(node) ? node : node.parent;
  while (p) {
    const step = keyStep(p);
    if (step.key !== undefined) return step.key;
    p = step.next;
  }
  return "";
}

function declIsSx(p) {
  if (/(^sx|Sx$|SX$)/.test(p.name.getText())) return true;
  return Boolean(p.type && /SxProps|SystemStyleObject/.test(p.type.getText()));
}

function callVerdict(p) {
  const callee = p.expression.getText();
  if (/(^|\.)unstable_sx$/.test(callee)) return true;
  if (/(^|\.)(styled|keyframes|css)$/.test(callee) || /^styled\(/.test(callee)) return false;
  return undefined;
}

/** Ancestors that can only say YES (this is an sx value) — undefined otherwise. */
function sxDeclarationVerdict(p) {
  if (ts.isPropertyAssignment(p) && propName(p) === "sx") return true;
  if (ts.isVariableDeclaration(p) && declIsSx(p)) return true;
  if (ts.isFunctionLike(p) && p.type && /SxProps|SystemStyleObject/.test(p.type.getText())) return true;
  return undefined;
}

/** true / false when this ancestor decides "is this an sx value?", undefined to keep climbing. */
function sxVerdict(p) {
  if (ts.isJsxAttribute(p)) return p.name.getText() === "sx";
  if (ts.isCallExpression(p)) return callVerdict(p);
  if (ts.isTaggedTemplateExpression(p)) return false;
  return sxDeclarationVerdict(p);
}

/** Whether a node sits inside an `sx` value — where spacing numbers are units and `borderRadius` a shape multiple. */
function inSxContext(node) {
  for (let p = node.parent; p; p = p.parent) {
    const verdict = sxVerdict(p);
    if (verdict !== undefined) return verdict;
  }
  return false;
}

const isLengthKey = (key) =>
  SPACING_KEYS.has(key) || RADIUS_KEYS.test(key) || BOX_KEYS.has(key) || HAIRLINE_KEY.test(key) ||
  (LENGTH_NAMED_KEY.test(key) && key !== "lineHeight");
const ruleForKey = (key, lengthRule) => (FONT_KEY.test(key) ? "raw-font-size" : lengthRule);

/** Is a literal number on this key raw? */
function isRawNumber(key, value, node) {
  if (value === 0) return false;
  if (HAIRLINE_KEY.test(key)) return Math.abs(value) > 1;
  const sx = inSxContext(node);
  if (SPACING_KEYS.has(key) || key === "borderRadius") return !sx;
  if (BOX_KEYS.has(key)) return !(sx && Math.abs(value) <= 1);
  if (key === "size") return Math.abs(value) > 1;
  return true;
}

/**
 * Whether a non-literal expression is a NUMBER — needs the type checker. An
 * UNTYPED (`any`) value counts too: the scanner cannot prove it relative, and
 * treating "unknown" as "fine" is how a gate goes quiet. A value that is right
 * anyway can be typed, or argued as `exempt`.
 */
function isNumberTyped(checker, expr) {
  if (!checker) return false;
  const type = checker.getTypeAtLocation(expr);
  if ((type.flags & ts.TypeFlags.Any) !== 0) return true;
  const isNum = (t) => (t.flags & ts.TypeFlags.NumberLike) !== 0;
  const isNullish = (t) => (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) !== 0;
  if (type.isUnion()) return type.types.every((t) => isNum(t) || isNullish(t)) && type.types.some(isNum);
  return isNum(type);
}

const isStringy = (e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e);

/** A value on a length key that is a NAME holding a number (metrics constant, size map, prop default). */
function isTypedRawValue(ctx, key, expr, node) {
  if (!ctx.checker || isStringy(expr) || ts.isObjectLiteralExpression(expr)) return false;
  if (HAIRLINE_KEY.test(key) && isHairlineName(expr, ctx.sf)) return false;
  if (isRelative(expr, ctx) || !isNumberTyped(ctx.checker, expr)) return false;
  const sx = inSxContext(node);
  return !(sx && (SPACING_KEYS.has(key) || key === "borderRadius"));
}

/** `divider ? 1 : 0` — a choice between literals is judged literal by literal. */
function literalBranches(expr) {
  const e = unwrap(expr);
  if (!ts.isConditionalExpression(e)) return null;
  const a = numericValue(e.whenTrue);
  const b = numericValue(e.whenFalse);
  return a !== null && b !== null ? [a, b] : null;
}

function checkValue(ctx, key, expr, node) {
  const branches = literalBranches(expr);
  if (branches) {
    if (branches.some((v) => isRawNumber(key, v, node))) ctx.add(ruleForKey(key, "raw-number-length"), node);
    return;
  }
  const value = numericValue(expr);
  if (value !== null) {
    if (isRawNumber(key, value, node)) ctx.add(ruleForKey(key, "raw-number-length"), node);
  } else if (isTypedRawValue(ctx, key, expr, node)) {
    ctx.add(ruleForKey(key, "raw-number-length"), node);
  }
}

// ---- checks, one per node kind ---------------------------------------------

function checkProperty(node, ctx) {
  if (ctx.isMetrics || !(ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))) return;
  const key = styleKeyOf(node);
  if (!key || !isLengthKey(key)) return;
  const init = ts.isPropertyAssignment(node) ? unwrap(node.initializer) : node.name;
  const values = ts.isArrayLiteralExpression(init) ? init.elements : [init];
  for (const v of values) checkValue(ctx, key, v, node);
}

function checkLengths(ctx, node, text, key) {
  for (const m of text.matchAll(LENGTH)) {
    const value = Number(m[2]);
    if (value === 0) continue;
    const after = text.slice(m.index + m[0].length);
    const hairline = m[3] === "px" && Math.abs(value) === 1 && (HAIRLINE_KEY.test(key) || /^\s+(solid|dashed|dotted|double)\b/.test(after));
    if (!hairline) ctx.add(ruleForKey(key, "raw-length"), node);
  }
}

function checkColours(ctx, node, text, key) {
  if (HEX.test(text) || COLOR_FN.test(text)) return ctx.add("raw-color", node);
  if (!COLOR_KEY.test(key)) return undefined;
  if (RAMP_STRING.test(text.trim())) return ctx.add("palette-ramp", node);
  const words = text.toLowerCase().split(/[\s,()]+/);
  return words.some((w) => NAMED_COLORS.has(w)) ? ctx.add("raw-color", node) : undefined;
}

function textFindings(ctx, node, text) {
  const key = styleKeyOf(node);
  checkColours(ctx, node, text, key);
  if (!ctx.isMetrics) checkLengths(ctx, node, text, key);
}

function checkString(node, ctx) {
  if (!(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return;
  const p = node.parent;
  if (p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p))) return;
  textFindings(ctx, node, node.text);
}

function checkTemplateSpan(ctx, node, span) {
  const text = span.literal.text;
  const expr = span.expression.getText(ctx.sf);
  if (/^[0-9a-fA-F]{2}(?!\w)/.test(text) && /palette|\.main|\.light|\.dark|color/i.test(expr)) ctx.add("raw-color", node);
  const gluesUnit = /^(px|rem)\b/.test(text) && !(text.startsWith("px") && isPxSafe(span.expression, ctx));
  if (!ctx.isMetrics && gluesUnit) ctx.add(ruleForKey(styleKeyOf(node), "raw-length"), node);
}

function checkTemplate(node, ctx) {
  if (!ts.isTemplateExpression(node)) return;
  textFindings(ctx, node, node.head.text);
  for (const span of node.templateSpans) {
    textFindings(ctx, node, span.literal.text);
    checkTemplateSpan(ctx, node, span);
  }
}

/** `n + 'px'` — the concatenated twin of `${n}px`. */
function checkConcat(node, ctx) {
  if (ctx.isMetrics || !ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return;
  const right = node.right;
  if (!(ts.isStringLiteral(right) || ts.isNoSubstitutionTemplateLiteral(right)) || !/^(px|rem)\b/.test(right.text)) return;
  if (right.text.startsWith("px") && isPxSafe(node.left, ctx)) return;
  ctx.add(ruleForKey(styleKeyOf(node), "raw-length"), node);
}

function checkRamp(node, ctx) {
  const onPalette = (e) => /palette$/.test(e.getText(ctx.sf));
  if (ts.isPropertyAccessExpression(node) && (node.name.text === "grey" || node.name.text === "common") && onPalette(node.expression)) {
    ctx.add("palette-ramp", node);
  } else if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) &&
             /^(grey|common)$/.test(node.argumentExpression.text) && onPalette(node.expression)) {
    ctx.add("palette-ramp", node);
  }
}

function jsxTagOf(attr) {
  const owner = attr.parent?.parent;
  return owner && (ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner)) ? owner.tagName.getText() : "";
}

function isRawJsxValue(ctx, init) {
  if (ts.isStringLiteral(init)) return /^\d+(\.\d+)?$/.test(init.text) && Number(init.text) > 1;
  if (!ts.isJsxExpression(init) || !init.expression) return false;
  const num = numericValue(init.expression);
  if (num !== null) return Math.abs(num) > 1;
  return !isRelative(init.expression, ctx) && isNumberTyped(ctx.checker, init.expression);
}

function checkJsxSize(node, ctx) {
  if (ctx.isMetrics || !ts.isJsxAttribute(node) || !node.initializer) return;
  const name = node.name.getText(ctx.sf);
  if (!JSX_SIZE_ATTRS.has(name)) return;
  const tag = jsxTagOf(node);
  if (SVG_SHAPES.has(tag) || (name === "size" && COLUMN_SIZED_TAGS.test(tag))) return;
  if (isRawJsxValue(ctx, node.initializer)) ctx.add(name === "fontSize" ? "raw-font-size" : "raw-jsx-size", node);
}

function checkPxHelper(node, ctx) {
  if (!ctx.isMetrics && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "px") {
    ctx.add("px-helper", node);
  }
}

const isLengthConstantName = (name) =>
  CONSTANT_NAME.test(name) && CONSTANT_LENGTH_WORD.test(name) && !CONSTANT_NOT_LENGTH.test(name);
const holdsRawNumber = (init) => {
  const v = numericValue(init);
  return v !== null && Math.abs(v) > 1;
};

/** `const CELL_SIZE = 40` */
function checkConstant(node, ctx) {
  if (ctx.isMetrics || !ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
  if (isLengthConstantName(node.name.text) && holdsRawNumber(node.initializer)) ctx.add("layout-constant", node);
}

/** `function List({ itemHeight = 40 })` */
function checkLengthDefault(node, ctx) {
  if (ctx.isMetrics || !(ts.isParameter(node) || ts.isBindingElement(node))) return;
  if (!node.initializer || !ts.isIdentifier(node.name)) return;
  if (LENGTH_NAMED_KEY.test(node.name.text) && holdsRawNumber(node.initializer)) ctx.add("layout-constant", node);
}

const CHECKS = [
  checkString, checkTemplate, checkConcat, checkRamp, checkProperty,
  checkJsxSize, checkPxHelper, checkConstant, checkLengthDefault,
];

/** Every finding in one file, as `{ rule, line, snippet }`. Pass a checker to also catch number-typed names. */
export function scanSource(path, text, checker = null, sourceFile = null) {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = sourceFile ?? ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const ctx = {
    sf, checker, isMetrics: /\.metrics\.ts$/.test(path),
    add(rule, node) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      out.push({ rule, line, snippet: node.getText(sf).split("\n")[0].slice(0, 100) });
    },
  };
  const visit = (node) => {
    for (const check of CHECKS) check(node, ctx);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
