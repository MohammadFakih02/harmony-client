import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Blocks unauthenticated users from accessing protected routes.
// On first load, attempts a silent refresh using the httpOnly cookie
// before making a decision — so a page refresh doesn't kick you out.
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  // Not authenticated — try to restore session silently
  const restored = await auth.tryRestoreSession();
  if (restored) return true;

  return router.createUrlTree(['/login']);
};

// Blocks authenticated users from accessing guest-only routes (login, register).
// Redirects to /app if already logged in.
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    // Try restore first — if the cookie exists they should go straight to /app
    const restored = await auth.tryRestoreSession();
    if (!restored) return true; // not authenticated, allow access to login/register
  }

  return router.createUrlTree(['/app']);
};