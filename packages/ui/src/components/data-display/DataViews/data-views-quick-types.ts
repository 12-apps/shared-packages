/**
 * The quick-chip model, split from `data-views-types` at the file-size gate.
 */

/**
 * A ONE-CLICK FILTER: a toggle chip on the toolbar that applies one value of a
 * declared pill field.
 *
 * A pill is two clicks — open it, tick a value — which is right for a facet
 * with many values and wrong for the one question a page exists to answer
 * ("what is empty on the shelf?"). The chip writes the SAME state a pill would
 * (`pills[fieldId] = [value]`), so the URL, saved views, the active count and
 * "Limpar" treat it as the filter it is; the field it targets is not drawn as a
 * pill anywhere, the chips stand in for it. Chips sharing a `fieldId` are
 * mutually exclusive, and pressing the pressed chip clears it.
 *
 * Chips are on the overflow ladder like every control: they keep the bar ahead
 * of idle pills, and on a row too narrow for them they move into "Mais" as a
 * toggle rather than scrolling the bar sideways.
 */
export interface QuickFilterConfig {
  /** Stable id, for the test id and the React key. */
  id: string;
  label: string;
  /** The pill field this chip writes to. Declare it in `fields` too. */
  fieldId: string;
  /** The single value the chip applies. */
  value: string;
  /** How many rows the chip would show, when the host knows. */
  count?: number;
  /** Colours the count: what kind of attention the rows need. */
  tone?: "error" | "warning" | "info" | "success";
  /**
   * The page's DEFAULT view: this chip reads pressed while its field is EMPTY,
   * and pressing it empties the field rather than writing `[value]`.
   *
   * For a page whose unfiltered view is already one of the chips ("Precisa
   * repor"): seeding `[value]` to light the chip made the default view count as
   * a filter, so "Limpar" showed on arrival and did nothing — it cleared the
   * field and the host put it back. An empty field is no filter, so "Limpar",
   * the active count and the ladder see the default view as unfiltered, and
   * "Limpar" from any other chip lands back here. The HOST owns what an empty
   * field means: the grid applies no filter for it.
   */
  default?: boolean;
}
