import * as React from 'react';
import { Text as RNText, type TextStyle } from 'react-native';

/**
 * FREE-FORM CHILDREN, FLOWING AS THE WEB FLOWS THEM.
 *
 * `<Alert>O total é {total}.</Alert>` is THREE children — a string, a number
 * and another string. The web lays them out inline, as one sentence. React
 * Native has no inline text outside a `Text`, so a native component has to
 * wrap them; wrapping each child on its own puts every fragment on its own
 * line, which is what the harness caught: an alert body reading
 *
 *     O corpo do alerta na variante
 *     success
 *     .
 *
 * So CONSECUTIVE text children are grouped into one `Text` — the run flows as
 * a sentence — and any element child ends the run and renders as given, the
 * way a block element interrupts a paragraph on the web.
 */
const isText = (child: React.ReactNode): child is string | number =>
  typeof child === 'string' || typeof child === 'number';

/**
 * Fragments are flattened first. A caller writing `<Alert><>{a} de {b}</></Alert>`
 * hands over ONE child, and `React.Children.toArray` does not look inside it —
 * so without this the fragment would reach React Native holding bare strings,
 * which throws "Text strings must be rendered within a <Text> component".
 */
function flatten(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement(child) && child.type === React.Fragment
      ? flatten((child.props as { children?: React.ReactNode }).children)
      : [child],
  );
}

export function renderTextChildren(
  children: React.ReactNode,
  style: TextStyle,
  /** Passed to each run, for a surface that clips rather than wraps (a button label). */
  numberOfLines?: number,
): React.ReactNode {
  const out: React.ReactNode[] = [];
  let run: Array<string | number> = [];

  const flush = (): void => {
    if (run.length === 0) return;
    out.push(
      <RNText key={`text-${out.length}`} style={style} numberOfLines={numberOfLines}>
        {run}
      </RNText>,
    );
    run = [];
  };

  for (const child of flatten(children)) {
    if (isText(child)) {
      run.push(child);
      continue;
    }
    flush();
    out.push(child);
  }
  flush();

  return out;
}
