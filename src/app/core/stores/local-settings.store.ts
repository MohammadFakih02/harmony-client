import { effect } from '@angular/core';
import { getState, patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import {
  CHANNEL_SIDEBAR_MAX,
  CHANNEL_SIDEBAR_MIN,
  DEFAULT_LOCAL_SETTINGS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  LocalSettings,
  MessageDisplay,
  RIGHT_SIDEBAR_MAX,
  RIGHT_SIDEBAR_MIN,
} from '../models/settings.models';

export const LOCAL_SETTINGS_STORAGE_KEY = 'harmony-settings';

/** Merge persisted settings over the defaults so a newly-added field is always present. Exported
 *  (and pure) so the merge behaviour is unit-testable without the root-singleton store. */
export function loadLocalSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(LOCAL_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LOCAL_SETTINGS };
    const loaded = { ...DEFAULT_LOCAL_SETTINGS, ...(JSON.parse(raw) as Partial<LocalSettings>) };
    // Persisted widths are re-clamped so a stale/hand-edited value can't wedge the layout.
    loaded.channelSidebarWidth = clamp(loaded.channelSidebarWidth, CHANNEL_SIDEBAR_MIN, CHANNEL_SIDEBAR_MAX);
    loaded.rightSidebarWidth = clamp(loaded.rightSidebarWidth, RIGHT_SIDEBAR_MIN, RIGHT_SIDEBAR_MAX);
    return loaded;
  } catch {
    return { ...DEFAULT_LOCAL_SETTINGS };
  }
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const clampScale = (n: number) => clamp(n, FONT_SCALE_MIN, FONT_SCALE_MAX);

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
    setChannelSidebarWidth(width: number): void {
      patchState(store, { channelSidebarWidth: clamp(width, CHANNEL_SIDEBAR_MIN, CHANNEL_SIDEBAR_MAX) });
    },
    setRightSidebarWidth(width: number): void {
      patchState(store, { rightSidebarWidth: clamp(width, RIGHT_SIDEBAR_MIN, RIGHT_SIDEBAR_MAX) });
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
