import { createHash } from "node:crypto";
import { parseDocument } from "yaml";

/** Static, deployment-owned content only. Never populate this from tenant data. */
export interface SkillSource {
  name: string;
  files: Readonly<Record<string, string>>;
}

export interface SkillEntry {
  uri: string;
  frontmatter: Record<string, unknown>;
  resources: { uri: string; digest: string }[];
}

export interface SkillCatalog {
  /** Includes every served byte; hosts may include it in their surface version. */
  digest: string;
  list(cursor?: string): { skills: SkillEntry[]; nextCursor?: string };
  get(uri: string): SkillEntry | undefined;
  read(uri: string): { uri: string; mimeType: string; text: string } | undefined;
}

export class SkillCursorError extends Error {}

const KIB = 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function frontmatter(text: string, name: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error("Skill requires YAML frontmatter");
  const document = parseDocument(match[1]!, { uniqueKeys: true });
  if (document.errors.length || document.warnings.length) throw new Error("Invalid skill frontmatter");
  const value: unknown = document.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Skill frontmatter must be a mapping");
  }
  const result = value as Record<string, unknown>;
  if (result.name !== name || typeof result.description !== "string" || !result.description.trim()) {
    throw new Error("Skill frontmatter name/description is invalid");
  }
  // JSON-RPC cannot preserve non-finite numbers, undefined, or non-JSON values.
  JSON.stringify(result, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Non-JSON frontmatter");
    if (["undefined", "bigint", "function", "symbol"].includes(typeof item)) {
      throw new Error("Non-JSON frontmatter");
    }
    return item;
  });
  return result;
}

function safePath(path: string): boolean {
  return path.length <= 1024 && path.split("/").every((segment) =>
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) && !segment.endsWith("."),
  );
}

function validateParents(path: string, names: Set<string>) {
  if (!safePath(path)) throw new Error("Unsafe skill path");
  const segments = path.split("/");
  for (let end = 1; end < segments.length; end++) {
    if (names.has(segments.slice(0, end).join("/"))) throw new Error("Skill file/directory conflict");
  }
}

function buildEntry(namespace: string, source: SkillSource) {
  if (!NAME.test(source.name)) throw new Error("Invalid skill name");
  const files = Object.entries(source.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (!files.length || files.length > 100) throw new Error("Skill file count exceeds limits");
  const main = source.files["SKILL.md"];
  if (typeof main !== "string") throw new Error("Skill requires SKILL.md");
  const names = new Set(files.map(([path]) => path.toLowerCase()));
  for (const path of names) validateParents(path, names);
  const paths = new Set<string>();
  let size = 0;
  const contents = files.map(([path, text]) => {
    if (!safePath(path) || paths.has(path.toLowerCase())) throw new Error("Unsafe or duplicate skill path");
    paths.add(path.toLowerCase());
    if (typeof text !== "string" || Buffer.from(text, "utf8").toString("utf8") !== text) {
      throw new Error("Skill resources must be valid UTF-8 text");
    }
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > (path === "SKILL.md" ? 256 : 1024) * KIB) throw new Error("Skill resource exceeds limits");
    size += bytes;
    return { uri: `skill://${namespace}/${source.name}/${path}`, mimeType: "text/plain", text };
  });
  if (size > 5 * 1024 * KIB) throw new Error("Skill exceeds total size limit");
  const entry: SkillEntry = {
    uri: `skill://${namespace}/${source.name}/SKILL.md`,
    frontmatter: frontmatter(main, source.name),
    resources: contents.map(({ uri, text }) => ({ uri, digest: sha256(text) })),
  };
  return { entry, contents, size };
}

/**
 * Snapshot supplied UTF-8 files once. Requests only perform exact map lookups:
 * no filesystem, URL fetching, path decoding, or caller-selected source roots.
 * The conservative 7 MiB catalog ceiling leaves room for ZIP metadata at import.
 */
function validateCatalog(namespace: string, sources: readonly SkillSource[], pageSize: number) {
  if (!NAME.test(namespace)) throw new Error("Invalid skill namespace");
  if (!sources.length || sources.length > 5) throw new Error("Expected one to five skills");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5) throw new Error("Invalid skill page size");
}

export function createSkillCatalog(namespace: string, sources: readonly SkillSource[], pageSize = 5): SkillCatalog {
  validateCatalog(namespace, sources, pageSize);
  const built = sources.map((source) => buildEntry(namespace, source));
  const entries = built.map(({ entry }) => entry).sort((a, b) => a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0);
  if (new Set(entries.map(({ uri }) => uri)).size !== entries.length) throw new Error("Duplicate skill name");
  if (built.reduce((sum, item) => sum + item.size, 0) > 7 * 1024 * KIB) throw new Error("Catalog exceeds size limit");
  const resources = new Map(built.flatMap(({ contents }) => contents.map((item) => [item.uri, item] as const)));
  const digest = sha256(JSON.stringify(entries));
  const cursors = new Map<string, number>();
  for (let index = pageSize; index < entries.length; index += pageSize) cursors.set(`${digest}:${index}`, index);
  return Object.freeze({
    digest,
    list(cursor?: string) {
      const start = cursor === undefined ? 0 : cursors.get(cursor);
      if (start === undefined) throw new SkillCursorError("Invalid skills cursor");
      const next = start + pageSize;
      return {
        skills: structuredClone(entries.slice(start, next)),
        ...(next < entries.length ? { nextCursor: `${digest}:${next}` } : {}),
      };
    },
    get(uri: string) { return structuredClone(entries.find((entry) => entry.uri === uri)); },
    read(uri: string) { return structuredClone(resources.get(uri)); },
  });
}
