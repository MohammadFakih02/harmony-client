import { MobileNavService } from './mobile-nav.service';

describe('MobileNavService', () => {
  it('starts closed and opens/closes the left drawer', () => {
    const nav = new MobileNavService();
    expect(nav.leftDrawerOpen()).toBe(false);
    nav.openLeft();
    expect(nav.leftDrawerOpen()).toBe(true);
    nav.closeLeft();
    expect(nav.leftDrawerOpen()).toBe(false);
  });
});
