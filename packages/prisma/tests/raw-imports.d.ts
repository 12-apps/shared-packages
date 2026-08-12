/**
 * Vite `?raw` string imports used by the schema contract tests (the file's
 * text content, resolved at build time — no runtime fs access).
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
