/** Public profile shown in the full-profile modal (GET /api/users/{id}). `age` is computed
 *  server-side from the user's DOB (others never see the raw birthday). */
export interface PublicUserProfile {
  id: string;
  username: string;
  avatarKey: string | null;
  bannerKey: string | null;
  /** User-picked banner colour ("#rrggbb"); shown when no banner image is set. */
  bannerColor: string | null;
  bio: string | null;
  statusMessage: string | null;
  age: number | null;
  /** Who may open a DM with this user — lets the UI hide the Message action for a stranger when
   *  `friends_only`. The server still enforces on send regardless of what the client shows. */
  dmPrivacy: DmPrivacy;
}

/** Who may open a new DM with the user. */
export type DmPrivacy = 'everyone' | 'friends_only';

/** The current user's editable profile bits (GET /api/users/me) — includes the raw DOB. */
export interface MyEditableProfile {
  id: string;
  username: string;
  avatarKey: string | null;
  bannerKey: string | null;
  /** User-picked banner colour ("#rrggbb"); independent of theme/role colours. */
  bannerColor: string | null;
  bio: string | null;
  statusMessage: string | null;
  dateOfBirth: string | null; // ISO yyyy-MM-dd
  dmPrivacy: DmPrivacy;
}

/** Whole years from an ISO `yyyy-MM-dd` date of birth, or null when unset/invalid. */
export function ageFromIso(iso: string | null): number | null {
  if (!iso) return null;
  const dob = new Date(iso + 'T00:00:00');
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age--;
  return age < 0 ? null : age;
}
