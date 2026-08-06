import { environment } from '../../../environments/environment';

/**
 * Resolves a stored profile-asset key (avatars/… or banners/…) to the API's anonymous serve URL
 * (GET /api/files/public/{key} → 302 to a presigned GET). Already-absolute values (http/https,
 * data:, blob:) pass through untouched so previews and legacy URLs keep working; null stays null.
 */
export function publicFileUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^(https?:|data:|blob:)/i.test(key)) return key;
  return `${environment.apiUrl}/files/public/${key}`;
}
