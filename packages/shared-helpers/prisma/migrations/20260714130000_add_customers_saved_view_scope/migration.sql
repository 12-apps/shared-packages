-- FUT-148: the Clientes (customers) grid ships saved views too, so extend the
-- saved-filter scope domain to include CUSTOMERS. Same String+CHECK house style
-- as the ORDERS extension (FUT-134): drop then re-add the closed-set guard.
ALTER TABLE "saved_filters" DROP CONSTRAINT "saved_filters_scope_valid";
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_scope_valid"
  CHECK ("scope" IN ('PRODUCTS', 'INVENTORY', 'SUPPLIERS', 'ORDERS', 'CUSTOMERS'));
