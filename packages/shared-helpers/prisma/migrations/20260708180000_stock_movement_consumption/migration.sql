-- FUT-85 review: make the production-consumption ledger self-describing.
--
-- A Produção draws down its recipe components' stock; those StockMovement rows
-- were logged as a generic ADJUST, so a component's history read as a series of
-- anonymous adjustments. Add a distinct CONSUMPTION type so COGS/audit reports
-- that join on `type` can identify production consumption.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_type_valid";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_valid"
  CHECK ("type" IN ('RESTOCK', 'SALE', 'ADJUST', 'SPOILAGE', 'CONSUMPTION'));
