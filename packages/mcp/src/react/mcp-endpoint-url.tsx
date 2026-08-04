"use client";

import { Code } from "@12-apps/ui/typography/Code";

/**
 * The store's MCP endpoint URL. Client component because the copy interaction
 * needs the browser clipboard — the `@12-apps/ui` Code component provides the copy
 * affordance (`copyable`). Pass `copyable={false}` for a display-only field when
 * an external control owns the copy action (e.g. the connect flow's blue Copiar
 * button, which also gates the following steps on the copy).
 */
export function McpEndpointUrl({
  url,
  copyable = true,
}: {
  url: string;
  copyable?: boolean;
}): React.JSX.Element {
  return (
    <Code variant="block" copyable={copyable} data-testid="mcp-endpoint-url">
      {url}
    </Code>
  );
}
