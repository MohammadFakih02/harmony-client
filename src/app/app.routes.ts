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
    path: 'forgot-password',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/forgot-password/forgot-password').then(m => m.ForgotPassword),
  },
  {
    // Public reset-password landing — no guard, anonymous link (works whether or not this
    // browser has a session; the reset endpoint itself doesn't touch this browser's session).
    path: 'reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password/reset-password').then(m => m.ResetPassword),
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
        // Public-server discovery — browse + join discoverable guilds.
        path: 'discover',
        loadComponent: () =>
          import('./features/guilds/discover/discover').then(m => m.Discover),
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
    // Public verification-email landing — no guard, works logged-in or out (the confirm
    // endpoint itself is anonymous; a same-session match patches emailVerified locally).
    path: 'verify-email',
    loadComponent: () =>
      import('./features/auth/verify-email/verify-email').then((m) => m.VerifyEmail),
  },
  {
    // Public change-email confirmation landing — no guard, same reasoning as verify-email: the
    // link is opened from a mail client that may carry no session.
    path: 'confirm-email-change',
    loadComponent: () =>
      import('./features/auth/confirm-email-change/confirm-email-change').then(
        (m) => m.ConfirmEmailChange,
      ),
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
