import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from "@angular/core";
import { provideRouter } from "@angular/router";

import { routes } from "./app.routes";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { authInterceptor } from "./core/interceptors/auth.interceptor";
import { bigIntInterceptor } from "./core/interceptors/big-int.interceptor";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // bigIntInterceptor must be LAST: interceptors run in order for requests,
    // reverse for responses — last registered = first to process the response body.
    provideHttpClient(withInterceptors([authInterceptor, bigIntInterceptor])),
  ],
};
