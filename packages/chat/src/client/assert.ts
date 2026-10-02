import { UI_COPY_KEYS, type ChatUiCopy } from "./copy";

/** Screen copy keys absent or blank — checked when a surface is built. */
export function missingUiCopy(copy: ChatUiCopy | undefined): string[] {
  if (copy === undefined || copy === null) return [...UI_COPY_KEYS];
  return UI_COPY_KEYS.filter((key) => typeof copy[key] !== "string" || copy[key].trim() === "");
}
