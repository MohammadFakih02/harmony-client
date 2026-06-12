export interface GuildSummary {
  id: number;
  name: string;
  description: string | null;
  iconKey: string | null;
  bannerKey: string | null;
  memberCount: number;
  isPublic: boolean;
  inviteCode: string;
  ownerId: number;
}
