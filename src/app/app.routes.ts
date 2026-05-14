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
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
