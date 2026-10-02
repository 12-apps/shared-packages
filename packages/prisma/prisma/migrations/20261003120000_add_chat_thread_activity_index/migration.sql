-- @12-apps/chat: the index behind a host's "threads with activity since" query.
CREATE INDEX "chat_threads_tenant_id_last_message_at_idx" ON "chat_threads"("tenant_id", "last_message_at");
