import { MentionCandidate } from '../../core/models/member.models';

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
