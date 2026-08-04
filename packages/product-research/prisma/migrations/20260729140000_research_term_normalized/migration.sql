-- FUT-430: widened widget lookup. `term_normalized` mirrors the package's
-- normalizeText(term) — lowercased, accents stripped, punctuation runs
-- collapsed to single spaces — so the best-prices widget finds a product's
-- research past renames and accent variants. Kept in sync by the host on
-- write; this migration backfills existing rows.
--
-- The backfill folds accents in pure SQL via translate() (no `unaccent`
-- extension, which PGlite lacks — same doctrine as the FUT-168 search_name
-- migration) so it runs identically on PostgreSQL + PGlite. Characters
-- outside the mapped pt-BR set fall through to the punctuation collapse,
-- matching normalizeText for every term the pt-BR hosts store.

ALTER TABLE "research_requests" ADD COLUMN "term_normalized" TEXT;

UPDATE "research_requests"
  SET "term_normalized" = btrim(regexp_replace(
    translate(
      lower("term"),
      'áàâãäçéèêëíìîïóòôõöúùûüýÿñ',
      'aaaaaceeeeiiiiooooouuuuyyn'
    ),
    '[^a-z0-9,.]+', ' ', 'g'
  ));

CREATE INDEX "research_requests_client_id_term_normalized_idx"
    ON "research_requests"("client_id", "term_normalized");
