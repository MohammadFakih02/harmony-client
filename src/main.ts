import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { applyDesktopEnvironment } from './app/core/desktop/tauri-env';

// Rewrite the environment for the desktop (Tauri) app before anything reads it. No-op on web.
applyDesktopEnvironment();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
