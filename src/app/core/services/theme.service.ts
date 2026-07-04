import { Injectable, signal } from '@angular/core';

/**
 * Two-axis theming: a colour Palette (identity) × a Mode (light/dark).
 * Each palette ships a tuned light AND dark variant — CSS blocks in styles.css
 * keyed by `html.palette-{p}.mode-{m}`. Persisted as one key, `"{palette}:{mode}"`.
 */
export type Palette = 'violet' | 'midnight' | 'forest';
export type ThemeMode = 'dark' | 'light';

export interface PaletteOption {
  id: Palette;
  label: string;
  icon: string; // Font Awesome class
  description: string;
  /** Accent swatch shown in the Settings palette grid. */
  swatch: string;
}

export const PALETTE_OPTIONS: PaletteOption[] = [
  {
    id: 'violet',
    label: 'Violet',
    icon: 'fa-wand-magic-sparkles',
    description: 'The classic Harmony look',
    swatch: '#8b5cf6',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    icon: 'fa-star',
    description: 'Monochrome with an icy accent',
    swatch: '#0ea5e9',
  },
  {
    id: 'forest',
    label: 'Forest',
    icon: 'fa-leaf',
    description: 'Deep greens, emerald accent',
    swatch: '#10b981',
  },
];

const STORAGE_KEY = 'harmony-theme';
const DEFAULT_PALETTE: Palette = 'violet';
const DEFAULT_MODE: ThemeMode = 'dark';

/** Pre-rework values ("theme-dark" era) → their nearest palette:mode equivalent. */
const LEGACY_MAP: Record<string, string> = {
  'theme-dark': 'violet:dark',
  'theme-light': 'violet:light',
  'theme-midnight': 'midnight:dark',
  'theme-forest': 'forest:dark',
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _palette = signal<Palette>(DEFAULT_PALETTE);
  private readonly _mode = signal<ThemeMode>(DEFAULT_MODE);
  readonly palette = this._palette.asReadonly();
  readonly mode = this._mode.asReadonly();

  constructor() {
    const { palette, mode } = this.loadSaved();
    this.apply(palette, mode);
  }

  setPalette(palette: Palette): void {
    this.apply(palette, this._mode());
    this.persist();
  }

  setMode(mode: ThemeMode): void {
    this.apply(this._palette(), mode);
    this.persist();
  }

  private apply(palette: Palette, mode: ThemeMode): void {
    const html = document.documentElement;

    PALETTE_OPTIONS.forEach(opt => html.classList.remove(`palette-${opt.id}`));
    html.classList.remove('mode-dark', 'mode-light');
    // Legacy classes the pre-paint boot script may have applied from an old stored value.
    Object.keys(LEGACY_MAP).forEach(cls => html.classList.remove(cls));

    html.classList.add(`palette-${palette}`, `mode-${mode}`);

    this._palette.set(palette);
    this._mode.set(mode);
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, `${this._palette()}:${this._mode()}`);
  }

  private loadSaved(): { palette: Palette; mode: ThemeMode } {
    const raw = localStorage.getItem(STORAGE_KEY) ?? '';
    const normalized = LEGACY_MAP[raw] ?? raw;
    const [p, m] = normalized.split(':');

    const palette = PALETTE_OPTIONS.some(o => o.id === p) ? (p as Palette) : DEFAULT_PALETTE;
    const mode = m === 'light' || m === 'dark' ? (m as ThemeMode) : DEFAULT_MODE;
    return { palette, mode };
  }
}
