export interface GuildSummary {
  id: string;
  name: string;
  description: string | null;
  iconKey: string | null;
  bannerKey: string | null;
  memberCount: number;
  isPublic: boolean;
  ownerId: string;
}
