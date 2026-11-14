-- @12-apps/messaging: channel connections, the raw delivery inbox, conversations and messages.
CREATE TABLE "messaging_connections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "external_parent_id" TEXT,
    "display_address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "credential_sealed" TEXT NOT NULL,
    "status_reason" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messaging_connections_channel_check" CHECK ("channel" ~ '^[a-z][a-z0-9-]*$'),
    CONSTRAINT "messaging_connections_status_check" CHECK ("status" IN ('CONNECTED', 'REVOKED', 'ERROR'))
);

CREATE TABLE "messaging_inbox_deliveries" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "raw_body" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "messaging_inbox_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messaging_inbox_deliveries_state_check" CHECK ("state" IN ('PENDING', 'PROCESSED', 'FAILED'))
);

CREATE TABLE "messaging_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "contact_name" TEXT,
    "connection_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'AGENT',
    "last_inbound_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3),
    "has_text" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,
    "summary_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messaging_conversations_state_check" CHECK ("state" IN ('AGENT', 'HUMAN', 'CLOSED', 'OPTED_OUT'))
);

CREATE TABLE "messaging_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "options" TEXT,
    "transcript" TEXT,
    "attachment_ref" TEXT,
    "external_id" TEXT,
    "delivery_status" TEXT NOT NULL,
    "author_kind" TEXT NOT NULL,
    "staff_user_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "messaging_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messaging_messages_direction_check" CHECK ("direction" IN ('INBOUND', 'OUTBOUND')),
    CONSTRAINT "messaging_messages_kind_check" CHECK ("kind" IN ('TEXT', 'INTERACTIVE', 'AUDIO', 'OTHER')),
    CONSTRAINT "messaging_messages_delivery_status_check" CHECK ("delivery_status" IN ('RECEIVED', 'PENDING', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
    CONSTRAINT "messaging_messages_author_kind_check" CHECK ("author_kind" IN ('CONTACT', 'AGENT', 'STAFF')),
    -- A staff user id (optional) appears only on a staff message.
    CONSTRAINT "messaging_messages_staff_author_check" CHECK ("staff_user_id" IS NULL OR "author_kind" = 'STAFF'),
    -- An inbound message is always the contact's, and always has its channel id.
    CONSTRAINT "messaging_messages_inbound_check" CHECK ("direction" = 'OUTBOUND' OR ("author_kind" = 'CONTACT' AND "external_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "messaging_connections_channel_external_account_id_key" ON "messaging_connections"("channel", "external_account_id");
CREATE INDEX "messaging_connections_tenant_id_channel_idx" ON "messaging_connections"("tenant_id", "channel");

CREATE UNIQUE INDEX "messaging_inbox_deliveries_channel_body_hash_key" ON "messaging_inbox_deliveries"("channel", "body_hash");
CREATE INDEX "messaging_inbox_deliveries_state_received_at_idx" ON "messaging_inbox_deliveries"("state", "received_at");

CREATE UNIQUE INDEX "messaging_conversations_tenant_id_channel_contact_id_key" ON "messaging_conversations"("tenant_id", "channel", "contact_id");
CREATE INDEX "messaging_conversations_tenant_id_last_message_at_idx" ON "messaging_conversations"("tenant_id", "last_message_at");
CREATE INDEX "messaging_conversations_has_text_last_message_at_idx" ON "messaging_conversations"("has_text", "last_message_at");

CREATE UNIQUE INDEX "messaging_messages_channel_external_id_key" ON "messaging_messages"("channel", "external_id");
CREATE INDEX "messaging_messages_conversation_id_created_at_idx" ON "messaging_messages"("conversation_id", "created_at");

ALTER TABLE "messaging_messages" ADD CONSTRAINT "messaging_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "messaging_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
