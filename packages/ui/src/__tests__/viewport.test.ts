/**
 * Viewport helpers: full-height surfaces must be pinned to the DYNAMIC viewport,
 * because iOS resolves `100vh` against the large viewport and parks the bottom of
 * a fixed panel (the submit row) underneath the browser toolbar.
 */
import { describe, expect, it } from "vitest";

import {
  DYNAMIC_VIEWPORT_HEIGHT,
  VIEWPORT_HEIGHT_FALLBACK,
  dynamicViewportHeight,
  safeAreaBottom,
} from "../utils/viewport";

const SUPPORTS_DVH = `@supports (height: ${DYNAMIC_VIEWPORT_HEIGHT})`;

describe("dynamicViewportHeight", () => {
  it("emits the vh fallback up front and upgrades to dvh under @supports", () => {
    const styles = dynamicViewportHeight("height");

    expect(styles.height).toBe(VIEWPORT_HEIGHT_FALLBACK);
    expect(styles[SUPPORTS_DVH]).toEqual({ height: DYNAMIC_VIEWPORT_HEIGHT });
  });

  it("pins every requested property, so maxHeight can't re-clamp to 100vh", () => {
    const styles = dynamicViewportHeight("height", "maxHeight");

    expect(styles.height).toBe(VIEWPORT_HEIGHT_FALLBACK);
    expect(styles.maxHeight).toBe(VIEWPORT_HEIGHT_FALLBACK);
    expect(styles[SUPPORTS_DVH]).toEqual({
      height: DYNAMIC_VIEWPORT_HEIGHT,
      maxHeight: DYNAMIC_VIEWPORT_HEIGHT,
    });
  });

  it("defaults to `height` when called with no properties", () => {
    expect(dynamicViewportHeight()).toEqual(dynamicViewportHeight("height"));
  });
});

describe("safeAreaBottom", () => {
  it("keeps the base padding as the fallback and adds the inset on top", () => {
    const styles = safeAreaBottom(16);

    expect(styles.paddingBottom).toBe("16px");
    expect(styles["@supports (padding: max(0px))"]).toEqual({
      paddingBottom: "max(16px, calc(16px + env(safe-area-inset-bottom)))",
    });
  });
});
