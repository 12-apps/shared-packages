import type { WebContents } from "electron";

import type { RenderedBody } from "./page";

/**
 * Measure the loaded ticket's `<body>`, with scripts off.
 *
 * The window renders with `javascript: false`, so the page cannot report its
 * own height, and `executeJavaScript` has nothing to run in. The DevTools
 * protocol's DOM domain reads layout without running any page script. Its box
 * model is in CSS pixels, at 96 per inch, whatever the display's scale factor.
 *
 * A debugger somebody else already attached is used and left attached.
 */

const CSS_PX_PER_MM = 96 / 25.4;

interface BoxModel {
  model: { width: number; height: number };
}

export async function measureBody(webContents: WebContents): Promise<RenderedBody> {
  const cdp = webContents.debugger;
  const attachedHere = !cdp.isAttached();
  if (attachedHere) cdp.attach("1.3");
  try {
    const { root } = (await cdp.sendCommand("DOM.getDocument", { depth: 0 })) as { root: { nodeId: number } };
    const { nodeId } = (await cdp.sendCommand("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "body",
    })) as { nodeId: number };
    const { model } = (await cdp.sendCommand("DOM.getBoxModel", { nodeId })) as BoxModel;
    return { widthMm: model.width / CSS_PX_PER_MM, heightMm: model.height / CSS_PX_PER_MM };
  } finally {
    if (attachedHere) cdp.detach();
  }
}
