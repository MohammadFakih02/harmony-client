/**
 * Frontend mirror of the backend Permission [Flags] enum (§13). Values are powers of two; the role
 * editor toggles them with bitwise ops (all bits are ≤ 1<<26, safely within JS's 32-bit bitwise range).
 * The backend re-validates every change (you can't grant a bit you lack), so this is presentation only.
 */
export interface PermissionDef {
  bit: number;
  label: string;
  description: string;
}

export interface PermissionGroup {
  category: string;
  perms: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    category: 'General',
    perms: [
      { bit: 1 << 0, label: 'View Channels', description: 'See channels in the server.' },
      { bit: 1 << 1, label: 'Manage Channels', description: 'Create, edit, and delete channels.' },
      { bit: 1 << 2, label: 'Manage Roles', description: 'Create and edit roles below their highest role.' },
      { bit: 1 << 3, label: 'Manage Server', description: 'Change the server name and settings.' },
      { bit: 1 << 4, label: 'Create Invite', description: 'Create invites to the server.' },
      { bit: 1 << 26, label: 'Manage Invites', description: 'View and revoke any invite.' },
      { bit: 1 << 24, label: 'View Audit Log', description: 'See the record of moderation actions.' },
      { bit: 1 << 7, label: 'Administrator', description: 'All permissions. Grant with care.' },
    ],
  },
  {
    category: 'Moderation',
    perms: [
      { bit: 1 << 5, label: 'Kick Members', description: 'Remove members from the server.' },
      { bit: 1 << 6, label: 'Ban Members', description: 'Permanently ban members.' },
      { bit: 1 << 25, label: 'Timeout Members', description: 'Temporarily mute members.' },
    ],
  },
  {
    category: 'Text',
    perms: [
      { bit: 1 << 8, label: 'Send Messages', description: 'Send messages in text channels.' },
      { bit: 1 << 9, label: 'Send Replies', description: 'Reply to messages.' },
      { bit: 1 << 10, label: 'Embed Links', description: 'Links you send show a preview.' },
      { bit: 1 << 11, label: 'Attach Files', description: 'Upload files and media.' },
      { bit: 1 << 12, label: 'Read History', description: 'Read past messages.' },
      { bit: 1 << 13, label: 'Mention Everyone', description: 'Use @everyone and @here.' },
      { bit: 1 << 14, label: 'Manage Messages', description: "Delete others' messages." },
      { bit: 1 << 15, label: 'Pin Messages', description: 'Pin messages in a channel.' },
      { bit: 1 << 16, label: 'Add Reactions', description: 'React to messages.' },
    ],
  },
  {
    category: 'Voice',
    perms: [
      { bit: 1 << 17, label: 'Connect', description: 'Join voice channels.' },
      { bit: 1 << 18, label: 'Speak', description: 'Talk in voice channels.' },
      { bit: 1 << 19, label: 'Mute Members', description: 'Server-mute members in voice.' },
      { bit: 1 << 20, label: 'Deafen Members', description: 'Server-deafen members in voice.' },
      { bit: 1 << 21, label: 'Move Members', description: 'Move members between voice channels.' },
      { bit: 1 << 22, label: 'Stream', description: 'Share video / go live.' },
      { bit: 1 << 23, label: 'Use Video', description: 'Turn on the camera.' },
    ],
  },
];

/** Preset role color swatches (RGB ints). 0 = no color (default). */
export const ROLE_COLOR_PRESETS: number[] = [
  0x1abc9c, 0x2ecc71, 0x3498db, 0x9b59b6, 0xe91e63, 0xf1c40f, 0xe67e22, 0xe74c3c,
  0x95a5a6, 0x607d8b, 0x11806a, 0x1f8b4c, 0x206694, 0x71368a, 0xad1457, 0xc27c0e,
];

export const hasBit = (bits: number, bit: number): boolean => (bits & bit) === bit;
