import { GuildMember, MentionCandidate } from '../../core/models/member.models';
import { Role, roleColorHex } from '../../core/models/role.models';

/**
 * The broadcast-mention entries shown at the top of the autocomplete in guild channels.
 * They insert `@everyone` / `@here` literally; the server gates whether they actually
 * notify on the MentionEveryone permission (the message still sends regardless). Not
 * offered in DMs — there's no guild to address.
 */
export const EVERYONE_MENTION_CANDIDATES: MentionCandidate[] = [
  {
    userId: '',
    username: 'everyone',
    avatarKey: null,
    special: 'everyone',
    description: 'Notify everyone in this channel',
  },
  {
    userId: '',
    username: 'here',
    avatarKey: null,
    special: 'here',
    description: 'Notify only online members',
  },
];

/**
 * The full guild-channel autocomplete pool: @everyone/@here, then mentionable non-default roles
 * (colour-coded — the server expands them to their members), then members (mentionable by their
 * display name = server nickname ?? username, which is the literal inserted after '@'). Shared by
 * the composer and the inline message editor so both offer the same candidates.
 */
export function buildGuildMentionCandidates(members: GuildMember[], roles: Role[]): MentionCandidate[] {
  const roleCandidates: MentionCandidate[] = roles
    .filter((r) => !r.isDefault && r.isMentionable)
    .map((r) => ({
      userId: '',
      username: r.name,
      avatarKey: null,
      role: true,
      color: roleColorHex(r.color),
      description: 'Notify everyone with this role',
    }));
  const memberCandidates: MentionCandidate[] = members.map((m) => ({
    userId: m.userId,
    username: m.nickname ?? m.username,
    avatarKey: m.avatarKey,
  }));
  return [...EVERYONE_MENTION_CANDIDATES, ...roleCandidates, ...memberCandidates];
}
