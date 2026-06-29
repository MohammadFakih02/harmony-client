import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login/login').then(m => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/register/register').then(m => m.RegisterComponent),
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/shell/shell').then(m => m.ShellComponent),
    children: [
      {
        path: '',
        redirectTo: 'friends',
        pathMatch: 'full',
      },
      {
        path: 'friends',
        loadComponent: () =>
          import('./features/friends/friends').then(m => m.Friends),
      },
      {
        // Full-screen settings overlay — covers the window via a fixed-inset panel.
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings').then(m => m.Settings),
      },
      {
        // Direct messages reuse the Channel view with no parent guildId (DM mode).
        path: 'dm/:channelId',
        loadComponent: () =>
          import('./features/channels/channel').then(m => m.Channel),
      },
      {
        // Full-screen guild settings overlay — must precede `guilds/:guildId` so the more
        // specific path wins.
        path: 'guilds/:guildId/settings',
        loadComponent: () =>
          import('./features/guild-settings/guild-settings').then(m => m.GuildSettings),
      },
      {
        path: 'guilds/:guildId',
        loadComponent: () =>
          import('./features/guilds/guild').then(m => m.Guild),
        children: [
          {
            path: 'channels/:channelId',
            loadComponent: () =>
              import('./features/channels/channel').then(m => m.Channel),
          },
        ],
      },
    ],
  },
  {
    // Public shared-invite landing — handles its own auth (sends guests to login with a
    // returnUrl so the link survives), then previews + joins.
    path: 'invite/:code',
    loadComponent: () =>
      import('./features/guilds/invite-landing/invite-landing').then((m) => m.InviteLanding),
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
