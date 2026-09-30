// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createEmailAuth } from "../create-email-auth";
import { createEmailAuthScreens, PT_BR } from "../screens";

/**
 * The refusal on a server, which has no `document`.
 *
 * The refusal floats in the window, portalled into the document's body. A
 * server has neither, and a refusal is the answer to a request the browser
 * made, so there it renders nothing rather than reaching for `document.body`
 * and throwing.
 */
describe("the refusal on a server", () => {
  it("renders nothing, and does not reach for a document", () => {
    const { FailureBanner } = createEmailAuthScreens({
      client: createEmailAuth(),
      copy: PT_BR,
      useSession: () => ({ signInWithPassword: async () => ({ ok: false, reason: "unknown" }) as never }),
    });
    expect(typeof document).toBe("undefined");

    const html = renderToString(
      <FailureBanner title="Não deu certo" reason="invalid-credentials" onDismiss={() => {}} />,
    );

    expect(html).toBe("");
  });
});
