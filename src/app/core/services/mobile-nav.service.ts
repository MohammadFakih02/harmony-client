import { Injectable, signal } from '@angular/core';

/**
 * Left-drawer state for the mobile layout (guild rail + channel sidebar as one off-canvas panel),
 * shared between the shell (renders the drawer), the channel sidebar (closes it on navigation
 * taps), and page headers (hamburger openers). Deliberately no router subscription: a guild-rail
 * tap navigates to the guild's default channel but must KEEP the drawer open (Discord behavior),
 * so closing is wired at the individual tap sites instead. The right drawer (member list /
 * DM profile) keeps its existing shell signals — `showMembers` / `showDmProfile`. All methods are
 * harmless no-ops on desktop: the drawer classes are `max-md:`-scoped, so the state simply
 * doesn't matter above the breakpoint.
 */
@Injectable({ providedIn: 'root' })
export class MobileNavService {
  readonly leftDrawerOpen = signal(false);

  openLeft(): void {
    this.leftDrawerOpen.set(true);
  }

  closeLeft(): void {
    this.leftDrawerOpen.set(false);
  }
}
