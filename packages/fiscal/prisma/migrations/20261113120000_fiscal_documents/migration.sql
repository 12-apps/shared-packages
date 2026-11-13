-- @12-apps/fiscal (FUT-2237): the emitter profile, issuing points, one number
-- counter per issuing point and series, fiscal documents and their events.
-- Additive only: five new tables. Host ids (owner, subject) are stored by
-- value, with no foreign key into the host's tables.

CREATE TABLE "fiscal_emitter_profiles" (
    "owner_id"                        TEXT NOT NULL,
    "cnpj"                            TEXT NOT NULL,
    "state_registration"              TEXT NOT NULL,
    "municipal_registration"          TEXT,
    "cnae"                            TEXT,
    "legal_name"                      TEXT NOT NULL,
    "trade_name"                      TEXT,
    "tax_regime"                      TEXT NOT NULL,
    "regime"                          TEXT NOT NULL,
    "regime_effective_from"           DATE NOT NULL,
    "restaurant_regime"               BOOLEAN NOT NULL,
    "address"                         JSONB NOT NULL,
    "environment"                     TEXT NOT NULL,
    "document_policy"                 TEXT NOT NULL,
    "signing_identity"                TEXT NOT NULL,
    "certificate_ciphertext"          TEXT,
    "certificate_password_ciphertext" TEXT,
    "certificate_expires_at"          TIMESTAMP(3),
    "csc_id"                          TEXT,
    "csc_ciphertext"                  TEXT,
    "consent_recorded_at"             TIMESTAMP(3),
    "updated_at"                      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_emitter_profiles_pkey" PRIMARY KEY ("owner_id"),
    CONSTRAINT "fiscal_emitter_profiles_cnpj_check" CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    CONSTRAINT "fiscal_emitter_profiles_tax_regime_check"
      CHECK ("tax_regime" IN ('SIMPLES', 'SIMPLES_EXCESS', 'NORMAL', 'MEI')),
    CONSTRAINT "fiscal_emitter_profiles_regime_check"
      CHECK ("regime" IN ('SIMPLES', 'SIMPLES_IBS_CBS_REGULAR', 'REGIME_REGULAR', 'MEI', 'NAO_CONTRIBUINTE')),
    CONSTRAINT "fiscal_emitter_profiles_environment_check"
      CHECK ("environment" IN ('homologacao', 'producao')),
    CONSTRAINT "fiscal_emitter_profiles_document_policy_check"
      CHECK ("document_policy" IN ('ISSUED_HERE', 'ISSUED_ELSEWHERE', 'NONE')),
    CONSTRAINT "fiscal_emitter_profiles_signing_identity_check"
      CHECK ("signing_identity" IN ('STORE_CERTIFICATE', 'PLATFORM')),
    -- The certificate is both halves or neither, and its expiry comes with it.
    CONSTRAINT "fiscal_emitter_profiles_certificate_check"
      CHECK (
        ("certificate_ciphertext" IS NULL AND "certificate_password_ciphertext" IS NULL AND "certificate_expires_at" IS NULL)
        OR
        ("certificate_ciphertext" IS NOT NULL AND "certificate_password_ciphertext" IS NOT NULL AND "certificate_expires_at" IS NOT NULL)
      ),
    CONSTRAINT "fiscal_emitter_profiles_csc_check"
      CHECK ("csc_ciphertext" IS NULL OR "csc_id" IS NOT NULL)
);

CREATE INDEX "fiscal_emitter_profiles_certificate_expires_at_idx"
  ON "fiscal_emitter_profiles"("certificate_expires_at");

CREATE TABLE "fiscal_issuing_points" (
    "id"                 TEXT NOT NULL,
    "owner_id"           TEXT NOT NULL,
    "model"              TEXT NOT NULL,
    "online_series"      INTEGER NOT NULL,
    "contingency_series" INTEGER,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_issuing_points_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscal_issuing_points_model_check" CHECK ("model" IN ('NFE', 'NFCE')),
    CONSTRAINT "fiscal_issuing_points_online_series_check" CHECK ("online_series" BETWEEN 0 AND 889),
    -- No offline NF-e path in the fiscal service: only an NFC-e point has a contingency series.
    CONSTRAINT "fiscal_issuing_points_contingency_series_check"
      CHECK (
        "contingency_series" IS NULL
        OR ("model" = 'NFCE' AND "contingency_series" BETWEEN 0 AND 889 AND "contingency_series" <> "online_series")
      )
);

CREATE INDEX "fiscal_issuing_points_owner_id_idx" ON "fiscal_issuing_points"("owner_id");

CREATE TABLE "fiscal_number_counters" (
    "owner_id"         TEXT NOT NULL,
    "environment"      TEXT NOT NULL,
    "model"            TEXT NOT NULL,
    "series"           INTEGER NOT NULL,
    "issuing_point_id" TEXT NOT NULL,
    "series_kind"      TEXT NOT NULL,
    "next_number"      INTEGER NOT NULL,
    "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- One counter per series: a series belongs to ONE issuing point.
    CONSTRAINT "fiscal_number_counters_pkey" PRIMARY KEY ("owner_id", "environment", "model", "series"),
    CONSTRAINT "fiscal_number_counters_issuing_point_id_fkey"
      FOREIGN KEY ("issuing_point_id") REFERENCES "fiscal_issuing_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fiscal_number_counters_environment_check" CHECK ("environment" IN ('homologacao', 'producao')),
    CONSTRAINT "fiscal_number_counters_model_check" CHECK ("model" IN ('NFE', 'NFCE')),
    CONSTRAINT "fiscal_number_counters_series_kind_check" CHECK ("series_kind" IN ('ONLINE', 'CONTINGENCY')),
    -- nNF is 1 to 999 999 999; the next number after the last one is the ceiling.
    CONSTRAINT "fiscal_number_counters_next_number_check" CHECK ("next_number" BETWEEN 1 AND 1000000000)
);

CREATE INDEX "fiscal_number_counters_issuing_point_id_idx" ON "fiscal_number_counters"("issuing_point_id");

CREATE TABLE "fiscal_documents" (
    "id"               TEXT NOT NULL,
    "owner_id"         TEXT NOT NULL,
    "subject_id"       TEXT NOT NULL,
    "issuing_point_id" TEXT NOT NULL,
    "model"            TEXT NOT NULL,
    "environment"      TEXT NOT NULL,
    "series_kind"      TEXT NOT NULL,
    "series"           INTEGER NOT NULL,
    "number"           INTEGER NOT NULL,
    "key_code"         TEXT NOT NULL,
    "status"           TEXT NOT NULL,
    "sale"             JSONB NOT NULL,
    "totals"           JSONB NOT NULL,
    "buyer_tax_id"     TEXT,
    "access_key"       TEXT,
    "protocol"         TEXT,
    "status_code"      TEXT,
    "status_reason"    TEXT,
    "last_error_class" TEXT,
    "outcome_unknown"  BOOLEAN NOT NULL DEFAULT false,
    "issued_at"        TEXT NOT NULL,
    "authorized_at"    TEXT,
    "contingency"      JSONB,
    "cancelled_at"     TEXT,
    "cancel_reason"    TEXT,
    "cancel_protocol"  TEXT,
    "replaced_by_id"   TEXT,
    "number_void"      TEXT,
    "xml_key"          TEXT,
    "event_xml_key"    TEXT,
    "attempts"         INTEGER NOT NULL DEFAULT 0,
    "created_at"       TIMESTAMP(3) NOT NULL,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscal_documents_model_check" CHECK ("model" IN ('NFE', 'NFCE')),
    CONSTRAINT "fiscal_documents_environment_check" CHECK ("environment" IN ('homologacao', 'producao')),
    CONSTRAINT "fiscal_documents_series_kind_check" CHECK ("series_kind" IN ('ONLINE', 'CONTINGENCY')),
    CONSTRAINT "fiscal_documents_number_check" CHECK ("number" BETWEEN 1 AND 999999999),
    CONSTRAINT "fiscal_documents_key_code_check" CHECK ("key_code" ~ '^[0-9]{8}$'),
    CONSTRAINT "fiscal_documents_status_check"
      CHECK ("status" IN ('PENDING', 'SUBMITTED', 'AUTHORIZED', 'REJECTED', 'DENIED', 'CONTINGENCY', 'CANCELLED', 'REPLACED')),
    CONSTRAINT "fiscal_documents_number_void_check"
      CHECK ("number_void" IS NULL OR "number_void" IN ('LOOKUP_FIRST', 'INUTILIZE', 'CANCEL', 'INUTILIZED', 'CANCELLED')),
    CONSTRAINT "fiscal_documents_last_error_class_check"
      CHECK ("last_error_class" IS NULL OR "last_error_class" IN ('REJECTED', 'RETRYABLE', 'CONTINGENCY', 'AUTH', 'INVALID', 'INTERNAL')),
    -- An authorised, denied or cancelled document carries its key and protocol.
    CONSTRAINT "fiscal_documents_authorized_check"
      CHECK ("status" NOT IN ('AUTHORIZED', 'DENIED', 'CANCELLED') OR ("access_key" IS NOT NULL AND "protocol" IS NOT NULL)),
    CONSTRAINT "fiscal_documents_contingency_check"
      CHECK ("status" <> 'CONTINGENCY' OR ("series_kind" = 'CONTINGENCY' AND "contingency" IS NOT NULL AND "xml_key" IS NOT NULL)),
    CONSTRAINT "fiscal_documents_replaced_check"
      CHECK ("status" <> 'REPLACED' OR ("replaced_by_id" IS NOT NULL AND "number_void" IS NOT NULL))
);

CREATE UNIQUE INDEX "fiscal_documents_access_key_key" ON "fiscal_documents"("access_key");
CREATE UNIQUE INDEX "fiscal_documents_owner_id_environment_model_series_number_key"
  ON "fiscal_documents"("owner_id", "environment", "model", "series", "number");
CREATE INDEX "fiscal_documents_owner_id_subject_id_model_idx" ON "fiscal_documents"("owner_id", "subject_id", "model");
CREATE INDEX "fiscal_documents_status_updated_at_idx" ON "fiscal_documents"("status", "updated_at");
CREATE INDEX "fiscal_documents_number_void_updated_at_idx" ON "fiscal_documents"("number_void", "updated_at");

CREATE TABLE "fiscal_document_events" (
    "id"          TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "kind"        TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status"   TEXT NOT NULL,
    "at"          TIMESTAMP(3) NOT NULL,
    "error_class" TEXT,
    "code"        TEXT,
    "answer"      JSONB,

    CONSTRAINT "fiscal_document_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscal_document_events_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fiscal_document_events_kind_check"
      CHECK ("kind" IN ('SUBMIT', 'AUTHORIZE', 'DENY', 'REJECT', 'RETRY', 'SIGN_OFFLINE', 'REPLACE', 'CANCEL', 'LOOKUP', 'INUTILIZE'))
);

CREATE INDEX "fiscal_document_events_document_id_at_idx" ON "fiscal_document_events"("document_id", "at");
