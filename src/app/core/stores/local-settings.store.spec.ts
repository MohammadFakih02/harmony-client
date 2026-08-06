import { TestBed } from '@angular/core/testing';
import {
  LocalSettingsStore,
  loadLocalSettings,
  LOCAL_SETTINGS_STORAGE_KEY,
} from './local-settings.store';
import { DEFAULT_LOCAL_SETTINGS } from '../models/settings.models';

describe('loadLocalSettings (merge)', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing is persisted', () => {
    expect(loadLocalSettings()).toEqual(DEFAULT_LOCAL_SETTINGS);
  });

  it('merges persisted values over the defaults', () => {
    localStorage.setItem(
      LOCAL_SETTINGS_STORAGE_KEY,
      JSON.stringify({ messageDisplay: 'compact' }),
    );
    const loaded = loadLocalSettings();
    expect(loaded.messageDisplay).toBe('compact');
    // Unspecified field falls back to the default.
    expect(loaded.fontScale).toBe(DEFAULT_LOCAL_SETTINGS.fontScale);
  });

  it('falls back to defaults on malformed JSON', () => {
    localStorage.setItem(LOCAL_SETTINGS_STORAGE_KEY, 'not json{');
    expect(loadLocalSettings()).toEqual(DEFAULT_LOCAL_SETTINGS);
  });
});

describe('LocalSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.style.removeProperty('--app-font-scale');
    TestBed.configureTestingModule({ providers: [LocalSettingsStore] });
  });

  it('persists changes and applies the DOM side-effects', () => {
    const store = TestBed.inject(LocalSettingsStore);

    store.setReducedMotion(true);
    store.setFontScale(1.2);
    TestBed.tick(); // flush the effect

    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('1.2');

    const saved = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_STORAGE_KEY)!);
    expect(saved.reducedMotion).toBe(true);
    expect(saved.fontScale).toBe(1.2);
  });

  it('clamps the font scale to its bounds', () => {
    const store = TestBed.inject(LocalSettingsStore);
    store.setFontScale(99);
    expect(store.fontScale()).toBeLessThanOrEqual(1.3);
    store.setFontScale(0.1);
    expect(store.fontScale()).toBeGreaterThanOrEqual(0.85);
  });
});
