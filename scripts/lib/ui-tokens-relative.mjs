// Is this expression's number THEME-RELATIVE? — for the ui-tokens scanner
// (`./ui-tokens-scan.mjs`, FUT-2585).
//
// A value is relative when it comes from the vocabulary (`rem`, `remPx`,
// `fieldHeight`/`fieldHeightRem` — never the fixed-16px `fieldHeightPx` —
// `theme.spacing`, `theme.shape.borderRadius`), and it stays
// relative through the things JavaScript layout does with one: a name that
// holds it (`const pitch = remPx(theme, 52)`), a member of an object built
// from it, scaling by a count (`i * pitch`), `Math.max/min/round` over
// relative values, and a `? :` whose branches both are. ADDING a raw number
// breaks it (`remPx(theme, 52) + 40` is 40 raw pixels riding along), and so
// does anything the scanner cannot trace — which is then reported, never
// assumed. A number measured at runtime (`element.scrollTop`, a dragged width)
// is not traceable to the theme and stays a finding; the ledger's `exempt`
// kind is where that argument is written down.
import ts from "typescript";

import { THEME_RELATIVE_MEMBER, VOCAB_CALL } from "./ui-tokens-keys.mjs";

const MAX_DEPTH = 4;
const MATH_OVER_VALUES = /^Math\.(max|min|round|floor|ceil|abs)$/;
const HAIRLINE_NAME = /(^|\.)[A-Z_]*(BORDER_WIDTH|HAIRLINE)[A-Z_]*$/;

/** Strip parentheses and `as`/`satisfies`/`<T>` wrappers. */
export function unwrap(expr) {
  let e = expr;
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e))) {
    e = e.expression;
  }
  return e;
}

const isZero = (a) => ts.isNumericLiteral(unwrap(a)) && Number(unwrap(a).text) === 0;
const isOne = (a) => ts.isNumericLiteral(unwrap(a)) && Number(unwrap(a).text) === 1;

/** The declaration a name or member reads, through an `import`. */
function declarationOf(e, checker) {
  let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(e) ? e.name : e);
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.valueDeclaration;
}

/**
 * Does this name HOLD 1? Its type is the literal `1` (`export const
 * FIELD_BORDER_WIDTH = 1`), or it is a `const` / frozen member initialised to
 * `1` (`{ FIELD_BORDER_WIDTH: 1 }`, whose type widens to `number`).
 */
function holdsOne(e, checker) {
  const type = checker.getTypeAtLocation(e);
  if (type.isNumberLiteral()) return type.value === 1;
  const decl = declarationOf(e, checker);
  return Boolean(decl) && (isConstVariable(decl) || isFrozenMember(decl)) && decl.initializer !== undefined && isOne(decl.initializer);
}

/**
 * The named hairline (`FIELD_BORDER_WIDTH`) — the one literal the vocabulary
 * keeps on purpose. The NAME alone is not the argument: a `FOCUS_BORDER_WIDTH
 * = 2` is a 2px length wearing a hairline's name, so with a checker the name
 * must also hold 1 — the same value the string path asks of a `1px`
 * (`./ui-tokens-scan.mjs`, `checkLengths`). Without one (the syntax-only
 * fixtures) the value cannot be read, and the name is taken as said.
 */
export const isHairlineName = (expr, ctx) => {
  const e = unwrap(expr);
  if (!HAIRLINE_NAME.test(e.getText(ctx.sf))) return false;
  return !ctx.checker || holdsOne(e, ctx.checker);
};

/** Only a `const` is traced: a `let` can be reassigned (`grow += 40`) after an initialiser that was relative. */
const isConstVariable = (decl) =>
  ts.isVariableDeclaration(decl) && (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0;

const ASSIGNMENT_OPS = new Set([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken,
]);

/** Every member name this file WRITES to (`x.h = …`, `x.h += …`, `x['h'] = …`, `x.h++`) — cached per file. */
function writtenMembers(sf) {
  if (sf.__uiTokensWritten) return sf.__uiTokensWritten;
  const written = new Set();
  const nameOf = (t) => (ts.isPropertyAccessExpression(t) ? t.name.text
    : ts.isElementAccessExpression(t) && ts.isStringLiteral(t.argumentExpression) ? t.argumentExpression.text : null);
  const visit = (n) => {
    if (ts.isBinaryExpression(n) && ASSIGNMENT_OPS.has(n.operatorToken.kind)) written.add(nameOf(n.left));
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
        (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) written.add(nameOf(n.operand));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  sf.__uiTokensWritten = written;
  return written;
}

/**
 * A member (`o.h` → `{ h: … }`) is traced only when its object literal is held
 * by a `const` and nothing in the file writes to a member of that name — the
 * same `grow += 40` hole, one level down.
 */
const isObjectWrapper = (n) =>
  ts.isObjectLiteralExpression(n) || ts.isPropertyAssignment(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n);

/** The declaration holding the object literal a property sits in. */
function holderOf(decl) {
  let holder = decl.parent;
  while (holder && isObjectWrapper(holder)) holder = holder.parent;
  return holder;
}

function isFrozenMember(decl) {
  if (!ts.isPropertyAssignment(decl) || !ts.isIdentifier(decl.name)) return false;
  const holder = holderOf(decl);
  return Boolean(holder) && isConstVariable(holder) && !writtenMembers(decl.getSourceFile()).has(decl.name.text);
}

function calleeName(call, sf) {
  const callee = call.expression;
  return ts.isPropertyAccessExpression(callee) && !ts.isPropertyAccessExpression(callee.expression)
    ? callee.getText(sf)
    : ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(sf);
}

function relativeCall(e, ctx, depth) {
  const name = calleeName(e, ctx.sf);
  if (VOCAB_CALL.test(name.replace(/^.*\./, ""))) return true;
  // A literal 0 in a clamp is neutral — `Math.max(pitch, 0)` is still `pitch`.
  const clampArg = (a) => isZero(a) || isRelative(a, ctx, depth + 1);
  return MATH_OVER_VALUES.test(name) && e.arguments.some((a) => !isZero(a)) && e.arguments.every(clampArg);
}

function relativeBinary(e, ctx, depth) {
  const op = e.operatorToken.kind;
  // `w ?? pitch`, `a || pitch`: either side may be the value. `c && pitch`: the right side is.
  if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) return relativeChoice([e.left, e.right], ctx, depth);
  if (op === ts.SyntaxKind.AmpersandAmpersandToken) return isRelative(e.right, ctx, depth + 1);
  const left = isRelative(e.left, ctx, depth + 1);
  const right = isRelative(e.right, ctx, depth + 1);
  // Scaling a relative length by a count or a ratio keeps it relative.
  if (op === ts.SyntaxKind.AsteriskToken || op === ts.SyntaxKind.SlashToken) return left || right;
  if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.MinusToken) return left && right;
  return false;
}

/** Follow a name or a member to what it was initialised with. */
function relativeDeclaration(e, ctx, depth) {
  if (!ctx.checker) return false;
  // `{ rowHeight }` — the shorthand's own symbol is the PROPERTY; the value is the variable.
  const symbol = ts.isShorthandPropertyAssignment(e.parent) && e.parent.name === e
    ? ctx.checker.getShorthandAssignmentValueSymbol(e.parent)
    : ctx.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(e) ? e.name : e);
  return declarationIsRelative(symbol?.valueDeclaration, ctx, depth);
}

/** What a declaration was initialised with: `const x = …`, `{ x: … }`, or `{ x }` → the variable `x`. */
function declarationIsRelative(decl, ctx, depth) {
  if (!decl || depth > MAX_DEPTH) return false;
  if (ts.isShorthandPropertyAssignment(decl)) {
    return declarationIsRelative(ctx.checker.getShorthandAssignmentValueSymbol(decl)?.valueDeclaration, ctx, depth + 1);
  }
  const init = isConstVariable(decl) || isFrozenMember(decl) ? decl.initializer : undefined;
  return init !== undefined && isRelative(init, ctx, depth + 1);
}

const isNullish = (b) => {
  const e = unwrap(b);
  return e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === "undefined");
};
const isStringLeaf = (b) => ts.isStringLiteral(unwrap(b)) || ts.isNoSubstitutionTemplateLiteral(unwrap(b));
/** A branch that carries no length of its own: 0, null/undefined, or a keyword string (`'auto'`, `'none'`). */
const isNeutral = (b) => isZero(b) || isNullish(b) || isStringLeaf(b);

/** `c ? pitch : 0`, `c ? pitch : undefined` — every branch relative or neutral, not all of them neutral. */
function relativeChoice(branches, ctx, depth) {
  return branches.some((b) => !isNeutral(b)) && branches.every((b) => isNeutral(b) || isRelative(b, ctx, depth + 1));
}

/** The composite shapes — calls, `? :`, arithmetic, negation — or undefined for a leaf. */
function relativeComposite(e, ctx, depth) {
  if (ts.isCallExpression(e)) return relativeCall(e, ctx, depth);
  if (ts.isConditionalExpression(e)) return relativeChoice([e.whenTrue, e.whenFalse], ctx, depth);
  if (ts.isBinaryExpression(e)) return relativeBinary(e, ctx, depth);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken) return isRelative(e.operand, ctx, depth + 1);
  return undefined;
}

/** Whether `expr`'s number traces back to the theme. */
export function isRelative(expr, ctx, depth = 0) {
  const e = unwrap(expr);
  if (!e || depth > MAX_DEPTH) return false;
  const composite = relativeComposite(e, ctx, depth);
  if (composite !== undefined) return composite;
  if (THEME_RELATIVE_MEMBER.test(e.getText(ctx.sf))) return true;
  return (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) && relativeDeclaration(e, ctx, depth);
}

/** Glued onto `px`, is this already right in px? Traced to `remPx`, or the named hairline. */
export const isPxSafe = (expr, ctx) => isHairlineName(expr, ctx) || isRelative(expr, ctx);
