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

/** The named hairline (`FIELD_BORDER_WIDTH`) — the one literal the vocabulary keeps on purpose. */
export const isHairlineName = (expr, sf) => HAIRLINE_NAME.test(unwrap(expr).getText(sf));

const isZero = (a) => ts.isNumericLiteral(unwrap(a)) && Number(unwrap(a).text) === 0;

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
  // Only a `const` is traced: a `let` can be reassigned (`grow += 40`) after an initialiser that was relative.
  const isConstVariable = ts.isVariableDeclaration(decl) && (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0;
  const init = isConstVariable || ts.isPropertyAssignment(decl) ? decl.initializer : undefined;
  return init !== undefined && isRelative(init, ctx, depth + 1);
}

const isNullish = (b) => {
  const e = unwrap(b);
  return e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === "undefined");
};
const isNeutral = (b) => isZero(b) || isNullish(b);

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
export const isPxSafe = (expr, ctx) => isHairlineName(expr, ctx.sf) || isRelative(expr, ctx);
