/**
 * Detects links to other Harmony messages inside message content, so they can render as an inline
 * "jump to message" card (the reader half of Copy Message Link). Only a *full* app link triggers a
 * card — never a bare id — mirroring {@link extractInviteCodes}. The link shape is the app's own
 * route so the same URL also works as a cold deep-link:
 *   guild → https://host/app/guilds/{guildId}/channels/{channelId}?m={messageId}
 *   DM    → https://host/app/dm/{channelId}?m={messageId}
 */
export interface MessageLinkRef {
  guildId: string | null; // null = a DM / group DM
  channelId: string;
  messageId: string;
  raw: string;
}

const GUILD_MSG_RE = /https?:\/\/\S+?\/app\/guilds\/(\d+)\/channels\/(\d+)\?m=(\d+)/gi;
const DM_MSG_RE = /https?:\/\/\S+?\/app\/dm\/(\d+)\?m=(\d+)/gi;

/** Message links found in `content`, in first-appearance order, deduped by target message. */
export function extractMessageLinks(content: string): MessageLinkRef[] {
  const out: MessageLinkRef[] = [];
  const seen = new Set<string>();
  const add = (ref: MessageLinkRef) => {
    if (seen.has(ref.messageId)) return;
    seen.add(ref.messageId);
    out.push(ref);
  };
  for (const m of content.matchAll(GUILD_MSG_RE)) {
    add({ guildId: m[1], channelId: m[2], messageId: m[3], raw: m[0] });
  }
  for (const m of content.matchAll(DM_MSG_RE)) {
    add({ guildId: null, channelId: m[1], messageId: m[2], raw: m[0] });
  }
  return out;
}

/** Builds the canonical app link to a message (the writer half — Copy Message Link). */
export function buildMessageLink(
  origin: string,
  guildId: string | null,
  channelId: string,
  messageId: string,
): string {
  return guildId
    ? `${origin}/app/guilds/${guildId}/channels/${channelId}?m=${messageId}`
    : `${origin}/app/dm/${channelId}?m=${messageId}`;
}
