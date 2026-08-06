/** One full-text search hit. Snowflake ids arrive as strings (bigInt interceptor); createdAt is unix-ms. */
export interface SearchResult {
  messageId: string;
  channelId: string;
  channelName: string;
  guildId: string | null;
  userId: string;
  username: string;
  avatarKey: string | null;
  content: string;
  createdAt: number;
}

export interface SearchResults {
  results: SearchResult[];
  hasMore: boolean;
}
