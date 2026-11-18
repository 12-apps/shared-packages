-- @domains: fiscal
-- @12-apps/fiscal (FUT-2239): a document's events may record the event 110300
-- "Vinculação Pagamento" (NT 2026.006 v1.00), kind LINK_PAYMENT. The check only
-- widens: every row the previous release writes still passes it.

ALTER TABLE "fiscal_document_events" DROP CONSTRAINT "fiscal_document_events_kind_check";
ALTER TABLE "fiscal_document_events" ADD CONSTRAINT "fiscal_document_events_kind_check"
  CHECK ("kind" IN ('SUBMIT', 'AUTHORIZE', 'DENY', 'REJECT', 'RETRY', 'SIGN_OFFLINE', 'REPLACE', 'CANCEL', 'LOOKUP', 'INUTILIZE',
                    'DEFER', 'RESIGN', 'RELEASE', 'WARN', 'LINK_PAYMENT'));
