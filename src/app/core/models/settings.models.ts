/** Local-only UI preferences, persisted to localStorage (no backend). Theme lives in ThemeService. */

export type MessageDisplay = 'cozy' | 'compact';

export interface LocalSettings {
  /** Cozy = roomy avatars + spacing; compact = denser, IRC-style rows. */
  messageDisplay: MessageDisplay;
  /** Multiplier applied to the app font size via the `--app-font-scale` CSS var. */
  fontScale: number;
  /** Disables non-essential animations (adds the `reduce-motion` class to <html>). */
  reducedMotion: boolean;
  /** Channel/DM-list sidebar width in px (drag-resizable). */
  channelSidebarWidth: number;
  /** Right panel width in px — the member list / DM profile column (drag-resizable). */
  rightSidebarWidth: number;
}

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.3;

export const CHANNEL_SIDEBAR_MIN = 200;
export const CHANNEL_SIDEBAR_MAX = 400;
export const RIGHT_SIDEBAR_MIN = 200;
export const RIGHT_SIDEBAR_MAX = 480;

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  messageDisplay: 'cozy',
  fontScale: 1,
  reducedMotion: false,
  channelSidebarWidth: 240,
  rightSidebarWidth: 280,
};
