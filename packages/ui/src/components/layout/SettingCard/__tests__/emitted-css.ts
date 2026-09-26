/**
 * The CSS Emotion wrote for one element, read back as text.
 *
 * jsdom has no layout engine and its CSSOM does not compute `grid-column` or
 * evaluate `@container`, so `toHaveStyle` cannot see either. What CAN be
 * asserted is the rule the component emitted — every `<style>` Emotion
 * inserted, filtered to the blocks naming one of the element's own classes.
 * (Layout itself is covered by the browser test stories.)
 */
export function emittedCss(element: Element): string {
  const classes = Array.from(element.classList).filter((name) => name.startsWith('css-'));
  const sheet = Array.from(document.head.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  return sheet
    .split('}')
    .filter((block) => classes.some((name) => block.includes(`.${name}`)))
    .join('}\n');
}
