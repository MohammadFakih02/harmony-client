import { Role, memberColor, memberHoistRole, roleColorHex } from './role.models';

const role = (over: Partial<Role> & { id: string; position: number }): Role => ({
  guildId: '1',
  name: `role-${over.id}`,
  color: 0,
  permissionBits: 0,
  isHoisted: false,
  isMentionable: true,
  isDefault: false,
  ...over,
});

// Rank-sorted desc, as RoleStore.rolesOf provides.
const roles: Role[] = [
  role({ id: 'admin', position: 3, color: 0xff0000, isHoisted: true }),
  role({ id: 'mod', position: 2, color: 0x00ff00, isHoisted: true }),
  role({ id: 'colorless', position: 1, color: 0, isHoisted: true }),
  role({ id: 'everyone', position: 0, color: 0, isDefault: true }),
];

describe('roleColorHex', () => {
  it('renders an RGB int as hex, null for 0', () => {
    expect(roleColorHex(0xff0000)).toBe('#ff0000');
    expect(roleColorHex(0x00ff00)).toBe('#00ff00');
    expect(roleColorHex(0)).toBeNull();
  });
});

describe('memberColor', () => {
  it('uses the highest-ranked coloured role the member holds', () => {
    expect(memberColor(['mod', 'admin'], roles)).toBe('#ff0000'); // admin outranks mod
    expect(memberColor(['mod'], roles)).toBe('#00ff00');
  });

  it('skips an outranking role that has no colour', () => {
    expect(memberColor(['colorless', 'mod'], roles)).toBe('#00ff00');
  });

  it('returns null when the member holds no coloured role', () => {
    expect(memberColor(['everyone', 'colorless'], roles)).toBeNull();
    expect(memberColor([], roles)).toBeNull();
  });
});

describe('memberHoistRole', () => {
  it('returns the highest-ranked hoisted role the member holds', () => {
    expect(memberHoistRole(['mod', 'admin'], roles)?.id).toBe('admin');
    expect(memberHoistRole(['colorless'], roles)?.id).toBe('colorless');
  });

  it('returns null when the member holds no hoisted role', () => {
    expect(memberHoistRole(['everyone'], roles)).toBeNull();
  });
});
