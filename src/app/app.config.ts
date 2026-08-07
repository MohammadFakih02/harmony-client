import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from "@angular/core";
import { provideRouter } from "@angular/router";

import { routes } from "./app.routes";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { retryInterceptor } from "./core/interceptors/retry.interceptor";
import { authInterceptor } from "./core/interceptors/auth.interceptor";
import { bigIntInterceptor } from "./core/interceptors/big-int.interceptor";

export const appConfig: ApplicationConfig = {
  providers: [
    // The app ships without zone.js (Angular-21 zoneless scaffolding); declaring it explicitly makes
    // the decision intentional rather than relying on the implicit "no zone detected" fallback, and
    // turns on Angular's zoneless scheduler + dev-mode reactivity assertions. CD is signal-driven.
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Order matters. retryInterceptor is FIRST (outermost) so it retries the whole chain — including
    // the auth refresh+retry — on a transient failure. bigIntInterceptor must be LAST: interceptors
    // run in order for requests, reverse for responses, so the last registered processes the body first.
    provideHttpClient(
      withInterceptors([retryInterceptor, authInterceptor, bigIntInterceptor]),
    ),
  ],
};
