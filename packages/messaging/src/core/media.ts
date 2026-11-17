import { ChannelMediaFailure, ChannelSendFailure, type ChannelMedia } from "./channel";
import type { EngineContext } from "./context";
import { errorText, MessagingMediaError } from "./errors";
import type { MessageView } from "./types";

/** The default cap on one download: 16 MiB, WhatsApp's own limit for audio. */
export const DEFAULT_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

export interface DownloadMediaOptions {
  /** The most bytes accepted; larger media is refused (`TOO_LARGE`). Default {@link DEFAULT_MEDIA_MAX_BYTES}. */
  maxBytes?: number;
}

/** The media id of a message that has downloadable media: an inbound audio. */
function mediaIdOf(message: MessageView): string {
  if (message.direction !== "INBOUND" || message.kind !== "AUDIO" || !message.attachmentRef) {
    throw new MessagingMediaError("NO_MEDIA", `message ${message.id} carries no downloadable media`);
  }
  return message.attachmentRef;
}

/** The adapter's download and the connection's opened credential, or a refusal. */
async function admitDownload(ctx: EngineContext, tenantId: string, message: MessageView) {
  const adapter = ctx.adapters.get(message.channel);
  if (!adapter) throw new MessagingMediaError("UNKNOWN_CHANNEL", `no adapter for channel "${message.channel}"`);
  if (!adapter.fetchMedia) throw new MessagingMediaError("UNSUPPORTED", `channel "${message.channel}" has no media download`);
  const { store, secrets } = ctx.config;
  const conversation = await store.getConversation(tenantId, message.conversationId);
  const connection = conversation ? await store.getConnection(tenantId, conversation.connectionId) : null;
  if (!connection || connection.status !== "CONNECTED" || connection.credentialSealed === null) {
    throw new MessagingMediaError("NOT_CONNECTED", `message ${message.id}: its connection is not connected`);
  }
  const credential = await secrets.open(connection.credentialSealed);
  return { fetchMedia: adapter.fetchMedia.bind(adapter), credential, accountId: connection.externalAccountId };
}

/** An adapter's failure as the engine's, with the credential scrubbed from its text should a channel echo it. */
function mediaFailureOf(error: unknown, credential: string): MessagingMediaError {
  const coded = error instanceof ChannelMediaFailure || error instanceof ChannelSendFailure;
  const raw = coded ? `${error.code}: ${error.message}` : errorText(error);
  const text = (credential ? raw.split(credential).join("[credential]") : raw).slice(0, 500);
  const code = error instanceof ChannelMediaFailure && error.code === "TOO_LARGE" ? "TOO_LARGE" : "CHANNEL_FAILED";
  return new MessagingMediaError(code, text);
}

/**
 * Download an inbound message's media into memory, through its connection's
 * credential (opened exactly as a send opens it). The bytes are returned and
 * never stored: retention is the host's call, and the package keeps none.
 */
export async function downloadMedia(
  ctx: EngineContext,
  tenantId: string,
  messageId: string,
  options: DownloadMediaOptions = {},
): Promise<ChannelMedia> {
  const message = await ctx.config.store.getMessage(tenantId, messageId);
  if (!message) throw new MessagingMediaError("NOT_FOUND", `no message ${messageId}`);
  const mediaId = mediaIdOf(message);
  const { fetchMedia, credential, accountId } = await admitDownload(ctx, tenantId, message);
  try {
    return await fetchMedia({ credential, accountId, mediaId, maxBytes: options.maxBytes ?? DEFAULT_MEDIA_MAX_BYTES });
  } catch (error) {
    throw mediaFailureOf(error, credential);
  }
}
