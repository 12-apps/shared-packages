/**
 * The gutter a DOCKED panel takes out of the canvas (FUT-755).
 *
 * The block configuration panel is non-modal: it does not cover the canvas, it
 * takes room FROM it. That is the whole point of the redesign — the popover it
 * replaced hid the block it was configuring, and a modal drawer repeats the
 * mistake with different geometry.
 *
 * The panel itself cannot narrow anything. It is rendered from inside the grid
 * cell of the block it configures and its surface is `position: fixed`, so its
 * own box contributes no width to the layout. Something ABOVE the canvas has to
 * give the width up.
 *
 * This is that something: the editor wraps its content in
 * {@link DockedPanelRegion}, an open panel reserves its width for as long as it
 * is mounted through {@link useDockReservation}, and the region pads itself by
 * the widest live reservation. Opening the panel then REFLOWS the 12-column
 * grid instead of floating over it, and no block ends up underneath the form
 * that configures it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";

interface DockedPanelApi {
  /** Hold `width` px of the canvas until the returned release runs. */
  reserve: (width: number) => () => void;
}

const DockedPanelContext = createContext<DockedPanelApi | null>(null);

/**
 * Drop ONE occurrence of `width`.
 *
 * Reservations are per mounted panel, not per distinct width: two panels of the
 * same width are two reservations, and releasing one must not release both.
 */
function withoutOne(widths: readonly number[], width: number): number[] {
  const at = widths.indexOf(width);
  if (at < 0) return [...widths];
  return [...widths.slice(0, at), ...widths.slice(at + 1)];
}

/**
 * The canvas that yields to a docked panel. Wrap the editor's content in it;
 * everything inside narrows when a panel is open and returns to full width when
 * it closes.
 */
export function DockedPanelRegion({ children }: { children: ReactNode }): JSX.Element {
  const [reserved, setReserved] = useState<readonly number[]>([]);

  const reserve = useCallback((width: number) => {
    setReserved((current) => [...current, width]);
    return () => setReserved((current) => withoutOne(current, width));
  }, []);

  const api = useMemo<DockedPanelApi>(() => ({ reserve }), [reserve]);
  const inset = reserved.length === 0 ? 0 : Math.max(...reserved);

  return (
    <DockedPanelContext.Provider value={api}>
      {/* An inline style rather than a class: the reserved width is a
          measurement handed over at runtime by whichever panel is open, and
          keeping it inline is what lets a test read back the width the canvas
          actually gave up. */}
      <div style={{ paddingRight: inset }} data-testid="report-editor-region">
        {children}
      </div>
    </DockedPanelContext.Provider>
  );
}

/**
 * Reserve `width` px of the canvas for as long as this component is mounted.
 *
 * `0` reserves nothing, which is what a bottom sheet passes: a sheet on a phone
 * legitimately overlays, and narrowing a 390px canvas would leave nothing to
 * narrow. Outside a {@link DockedPanelRegion} the hook is a no-op, so the panel
 * still renders standalone (a unit test, a host that mounts it on its own).
 */
export function useDockReservation(width: number): void {
  const dock = useContext(DockedPanelContext);

  useEffect(() => {
    if (dock === null || width <= 0) return undefined;
    return dock.reserve(width);
  }, [dock, width]);
}
