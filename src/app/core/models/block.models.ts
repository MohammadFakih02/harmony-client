/** A user the caller has blocked (GET /api/users/me/blocks). `createdAt` is unix-ms. */
export interface BlockedUser {
  id: string;
  username: string;
  avatarKey: string | null;
  bannerKey: string | null;
  createdAt: number;
}
