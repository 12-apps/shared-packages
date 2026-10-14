import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { handleMcpJsonRpc, UNAUTHORIZED_CODE, type McpJsonRpcOptions } from "./jsonrpc";
import type { ToolRegistry } from "./registry";
import { createSkillCatalog, type SkillSource } from "./skills";

function source(name = "example-skill"): SkillSource {
  return { name, files: {
    "SKILL.md": `---\nname: ${name}\ndescription: Inspect a sample\nmetadata:\n  language: pt-BR\n---\n# Olá\n`,
    "references/guide.md": "A referência original.\r\n",
  } };
}

const registry: ToolRegistry = {
  listTools: () => [],
  callTool: async () => ({ content: [], isError: false }),
};
const auth = { bearer: "test-bearer", scopes: ["mcp:read"] };

function rpc(method: string, params: unknown = {}, options?: McpJsonRpcOptions) {
  return handleMcpJsonRpc({ jsonrpc: "2.0", id: 42, method, params }, registry, auth,
    options ?? { serverInfo: { name: "test", version: "1" }, skills: createSkillCatalog("sample", [source()]) });
}

describe("static skills catalog", () => {
  it("returns complete frontmatter and original UTF-8 bytes with matching digests", () => {
    const catalog = createSkillCatalog("sample", [source()]);
    const entry = catalog.list().skills[0]!;
    expect(entry.frontmatter).toEqual({ name: "example-skill", description: "Inspect a sample", metadata: { language: "pt-BR" } });
    expect(entry.resources).toHaveLength(2);
    expect(catalog.get(entry.uri)).toEqual(entry);
    for (const resource of entry.resources) {
      const content = catalog.read(resource.uri)!;
      expect(content.uri).toBe(resource.uri);
      expect(resource.digest).toBe(`sha256:${createHash("sha256").update(content.text, "utf8").digest("hex")}`);
    }
    expect(catalog.read(entry.resources[1]!.uri)?.text).toBe("A referência original.\r\n");
  });

  it("snapshots inputs and isolates returned objects from later requests", () => {
    const input = source();
    const catalog = createSkillCatalog("sample", [input]);
    const before = catalog.list();
    const returned = catalog.list();
    returned.skills[0]!.frontmatter.description = "modified";
    returned.skills[0]!.resources.length = 0;
    (input.files as Record<string, string>)["SKILL.md"] = "changed";
    expect(catalog.list()).toEqual(before);
    expect(catalog.read(before.skills[0]!.uri)?.text).toContain("# Olá");
  });

  it("paginates deterministically and rejects fabricated or stale cursors", () => {
    const catalog = createSkillCatalog("sample", [source("z-last"), source("a-first")], 1);
    const first = catalog.list();
    expect(first.skills[0]!.frontmatter.name).toBe("a-first");
    const last = catalog.list(first.nextCursor);
    expect(last.skills[0]!.frontmatter.name).toBe("z-last");
    expect(last).not.toHaveProperty("nextCursor");
    expect(() => catalog.list("1")).toThrow("Invalid skills cursor");
    const changed = createSkillCatalog("sample", [source("a-first"), source("b-new")], 1);
    expect(() => changed.list(first.nextCursor)).toThrow("Invalid skills cursor");
  });

  it.each(["../secret", "/absolute", "a//b", "a/../b", "a\\b", "%2e%2e/secret", "a?query", "a#fragment", "a/."])("rejects unsafe path %s", (path) => {
    expect(() => createSkillCatalog("sample", [{ ...source(), files: { ...source().files, [path]: "no" } }])).toThrow("Unsafe");
  });

  it("rejects ambiguous paths, duplicate names, missing main files and invalid metadata", () => {
    expect(() => createSkillCatalog("sample", [source(), source()])).toThrow("Duplicate");
    expect(() => createSkillCatalog("sample", [{ ...source(), files: { "guide.md": "x" } }])).toThrow("SKILL.md");
    expect(() => createSkillCatalog("sample", [{ ...source(), files: { ...source().files, "skill.md": "x" } }])).toThrow("duplicate");
    expect(() => createSkillCatalog("sample", [{ ...source(), files: { ...source().files, references: "x" } }])).toThrow("file/directory conflict");
    for (const text of ["no yaml", "---\nname: wrong\ndescription: x\n---\n", "---\nname: example-skill\ndescription: x\nname: duplicate\n---\n"]) {
      expect(() => createSkillCatalog("sample", [{ ...source(), files: { "SKILL.md": text } }])).toThrow();
    }
  });

  it("enforces file, skill, catalog, UTF-8 and page-size bounds", () => {
    expect(() => createSkillCatalog("sample", [])).toThrow();
    expect(() => createSkillCatalog("sample", Array.from({ length: 6 }, (_, i) => source(`skill-${i}`)))).toThrow();
    expect(() => createSkillCatalog("sample", [source()], 0)).toThrow();
    expect(() => createSkillCatalog("sample", [source()], 1.5)).toThrow();
    const files = { ...source().files, ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`file-${i}.md`, "x"])) };
    expect(() => createSkillCatalog("sample", [{ ...source(), files }])).toThrow("file count");
    for (const [path, text] of [["SKILL.md", "x".repeat(256 * 1024 + 1)], ["large.md", "x".repeat(1024 * 1024 + 1)], ["bad.md", "\ud800"]]) {
      expect(() => createSkillCatalog("sample", [{ ...source(), files: { ...source().files, [path!]: text! } }])).toThrow();
    }
    const largeFiles = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`file-${i}.md`, "x".repeat(1024 * 1024)]));
    expect(() => createSkillCatalog("sample", [{ ...source(), files: { ...source().files, ...largeFiles } }])).toThrow("total size");
  });
});

describe("skills JSON-RPC", () => {
  it.each(["skills/list", "skills/get", "resources/read"])("accepts MCP request metadata for %s", async (method) => {
    const params = method === "skills/list" ? {} : { uri: "skill://sample/example-skill/SKILL.md" };
    expect(await rpc(method, { ...params, _meta: { progressToken: "probe", "example/context": true } })).not.toHaveProperty("error");
    expect(await rpc(method, { ...params, _meta: [] })).toMatchObject({ error: { code: -32602 } });
  });
  it("advertises the extension only when configured, without listChanged", async () => {
    expect((await rpc("initialize"))?.result).toMatchObject({ capabilities: { tools: {}, resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } } });
    const result = await rpc("initialize", {}, { serverInfo: { name: "plain", version: "1" } });
    expect(result?.result).toMatchObject({ capabilities: { tools: {} } });
    expect((result?.result as { capabilities: object }).capabilities).not.toHaveProperty("extensions");
  });

  it("serves list/get and exactly one matching resource", async () => {
    const listed = await rpc("skills/list");
    const entry = (listed?.result as { skills: { uri: string }[] }).skills[0]!;
    expect(await rpc("skills/get", { uri: entry.uri })).toMatchObject({ id: 42, result: { skill: entry } });
    const read = await rpc("resources/read", { uri: entry.uri });
    const contents = (read?.result as { contents: { uri: string; text: string }[] }).contents;
    expect(contents).toHaveLength(1);
    expect(contents[0]).toMatchObject({ uri: entry.uri, text: source().files["SKILL.md"] });
  });

  it.each([null, [], "bad", { cursor: 1 }, { cursor: "invalid" }, { extra: true }])("rejects malformed list parameters %j", async (params) => {
    expect(await rpc("skills/list", params)).toMatchObject({ error: { code: -32602 } });
  });

  it("returns defined errors for missing skills and resources without resolving paths", async () => {
    expect(await rpc("skills/get", { uri: "skill://sample/missing/SKILL.md" })).toMatchObject({ error: { code: -32602 } });
    expect(await rpc("resources/read", { uri: "file:///etc/passwd" })).toMatchObject({ error: { code: -32002 } });
    expect(await rpc("resources/read", { uri: "skill://sample/example-skill/../SKILL.md" })).toMatchObject({ error: { code: -32002 } });
    expect(await rpc("resources/read", {})).toMatchObject({ error: { code: -32602 } });
  });

  it.each(["skills/list", "skills/get", "resources/read"])("preserves optional support and requires auth for %s", async (method) => {
    const options = { serverInfo: { name: "test", version: "1" } };
    expect(await rpc(method, {}, options)).toMatchObject({ error: { code: -32601 } });
    const configured = { ...options, skills: createSkillCatalog("sample", [source()]) };
    const unauthenticated = await handleMcpJsonRpc({ jsonrpc: "2.0", id: 9, method }, registry, null, configured);
    expect(unauthenticated).toMatchObject({ error: { code: UNAUTHORIZED_CODE } });
    expect(await handleMcpJsonRpc({ jsonrpc: "2.0", method }, registry, auth, configured)).toBeNull();
  });
});
