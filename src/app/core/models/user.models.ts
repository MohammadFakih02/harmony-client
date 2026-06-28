/** Public profile shown in the full-profile modal (GET /api/users/{id}). `age` is computed
 *  server-side from the user's DOB (others never see the raw birthday). */
export interface PublicUserProfile {
  id: string;
  username: string;
  avatarKey: string | null;
  bannerKey: string | null;
  bio: string | null;
  statusMessage: string | null;
  age: number | null;
}

/** The current user's editable profile bits (GET /api/users/me) — includes the raw DOB. */
export interface MyEditableProfile {
  id: string;
  username: string;
  avatarKey: string | null;
  bannerKey: string | null;
  bio: string | null;
  statusMessage: string | null;
  dateOfBirth: string | null; // ISO yyyy-MM-dd
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
