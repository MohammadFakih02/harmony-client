export interface GuildSummary {
  id: string;
  name: string;
  description: string | null;
  iconKey: string | null;
  bannerKey: string | null;
  memberCount: number;
  isPublic: boolean;
  ownerId: string;
  // Welcome / system-message config (roadmap E#16). welcomeChannelId null = default text channel.
  welcomeChannelId: string | null;
  welcomeMessage: string | null;
  systemMessagesEnabled: boolean;
  // Requires a verified email address to join (invite redeem or discovery join). Opt-in per guild.
  requireVerifiedEmail: boolean;
}
