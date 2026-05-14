import { Injectable, signal } from '@angular/core';

export type Theme = 'theme-dark' | 'theme-light' | 'theme-midnight' | 'theme-forest';

export interface ThemeOption {
  id: Theme;
  label: string;
  icon: string; // Font Awesome class
  description: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'theme-dark',
    label: 'Dark',
    icon: 'fa-moon',
    description: 'Classic dark with violet accent',
  },
  {
    id: 'theme-light',
    label: 'Light',
    icon: 'fa-sun',
    description: 'Clean and bright',
  },
  {
    id: 'theme-midnight',
    label: 'Midnight',
    icon: 'fa-star',
    description: 'Pure black, OLED-friendly',
  },
  {
    id: 'theme-forest',
    label: 'Forest',
    icon: 'fa-leaf',
    description: 'Deep greens with emerald accent',
  },
];

const STORAGE_KEY = 'harmony-theme';
const DEFAULT_THEME: Theme = 'theme-dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _current = signal<Theme>(DEFAULT_THEME);
  readonly current = this._current.asReadonly();

  constructor() {
    this.applyTheme(this.loadSaved());
  }

  setTheme(theme: Theme): void {
    this.applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }

  toggle(): void {
    // Convenience toggle between dark and light only
    const next = this._current() === 'theme-light' ? 'theme-dark' : 'theme-light';
    this.setTheme(next);
  }

  isDark(): boolean {
    return this._current() !== 'theme-light';
  }

  private applyTheme(theme: Theme): void {
    const html = document.documentElement;

    // Remove all theme classes then add the new one
    THEME_OPTIONS.forEach(opt => html.classList.remove(opt.id));
    html.classList.add(theme);

    this._current.set(theme);
  }

  private loadSaved(): Theme {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return saved && THEME_OPTIONS.some(o => o.id === saved) ? saved : DEFAULT_THEME;
  }
}