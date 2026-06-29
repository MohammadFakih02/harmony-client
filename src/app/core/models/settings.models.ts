/** Local-only UI preferences, persisted to localStorage (no backend). Theme lives in ThemeService. */

export type MessageDisplay = 'cozy' | 'compact';

export interface LocalSettings {
  /** Cozy = roomy avatars + spacing; compact = denser, IRC-style rows. */
  messageDisplay: MessageDisplay;
  /** Multiplier applied to the app font size via the `--app-font-scale` CSS var. */
  fontScale: number;
  /** Disables non-essential animations (adds the `reduce-motion` class to <html>). */
  reducedMotion: boolean;
}

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.3;

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  messageDisplay: 'cozy',
  fontScale: 1,
  reducedMotion: false,
};
