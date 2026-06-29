import { effect } from '@angular/core';
import { getState, patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import {
  DEFAULT_LOCAL_SETTINGS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  LocalSettings,
  MessageDisplay,
} from '../models/settings.models';

export const LOCAL_SETTINGS_STORAGE_KEY = 'harmony-settings';

/** Merge persisted settings over the defaults so a newly-added field is always present. Exported
 *  (and pure) so the merge behaviour is unit-testable without the root-singleton store. */
export function loadLocalSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(LOCAL_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LOCAL_SETTINGS };
    return { ...DEFAULT_LOCAL_SETTINGS, ...(JSON.parse(raw) as Partial<LocalSettings>) };
  } catch {
    return { ...DEFAULT_LOCAL_SETTINGS };
  }
}

const clampScale = (n: number) => Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, n));

/**
 * Local-only UI personalization (message density, font scale, reduced motion), persisted to
 * localStorage. A single effect persists + applies the DOM side-effects on every change, so the
 * setters just patch state. Theme stays in ThemeService; `messageDisplay` is read directly by the
 * message list (the other two are global, so they're applied to <html> here).
 */
export const LocalSettingsStore = signalStore(
  { providedIn: 'root' },
  withState<LocalSettings>(loadLocalSettings()),
  withMethods((store) => ({
    setMessageDisplay(messageDisplay: MessageDisplay): void {
      patchState(store, { messageDisplay });
    },
    setFontScale(fontScale: number): void {
      patchState(store, { fontScale: clampScale(fontScale) });
    },
    setReducedMotion(reducedMotion: boolean): void {
      patchState(store, { reducedMotion });
    },
    reset(): void {
      patchState(store, { ...DEFAULT_LOCAL_SETTINGS });
    },
  })),
  withHooks({
    onInit(store) {
      effect(() => {
        const state = getState(store);
        try {
          localStorage.setItem(LOCAL_SETTINGS_STORAGE_KEY, JSON.stringify(state));
        } catch {
          // Ignore quota / private-mode failures — settings stay in-memory for the session.
        }
        const html = document.documentElement;
        html.classList.toggle('reduce-motion', state.reducedMotion);
        html.style.setProperty('--app-font-scale', String(state.fontScale));
      });
    },
  }),
);
