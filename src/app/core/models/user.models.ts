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
  /** The target's raw DM-privacy checklist (comma-separated DmAudience tokens). Prefer
   *  `canMessage` below to gate UI — this is exposed mainly for completeness. */
  dmPrivacy: string;
  /** Server-computed: may the CALLER open a new DM with this user right now? Already resolved
   *  against friendship/shared-guild — the client never has to parse dmPrivacy itself. */
  canMessage: boolean;
}

/** One audience a user's DM-privacy checklist can grant. Extensible: adding a new value here (and
 *  a matching checkbox in the settings UI) is the whole frontend half of a new audience type. */
export type DmAudience = 'everyone' | 'friends' | 'guild_members';

export const DM_AUDIENCE_OPTIONS: { value: DmAudience; label: string; description: string }[] = [
  { value: 'everyone', label: 'Everyone', description: 'Anyone can send you a direct message.' },
  {
    value: 'friends',
    label: 'Friends',
    description: 'Accepted friends can start a new conversation.',
  },
  {
    value: 'guild_members',
    label: 'Server Members',
    description: 'Anyone who shares a server with you can start a new conversation.',
  },
];

/** Parses the raw comma-separated checklist column into a set of audiences. */
export function parseDmAudiences(csv: string): Set<DmAudience> {
  return new Set(
    csv
      .split(',')
      .map((t) => t.trim())
      .filter((t): t is DmAudience => t === 'everyone' || t === 'friends' || t === 'guild_members'),
  );
}

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
  /** Raw comma-separated DM-privacy checklist — parse with parseDmAudiences. */
  dmPrivacy: string;
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
