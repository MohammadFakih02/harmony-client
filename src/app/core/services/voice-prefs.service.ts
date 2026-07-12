import { Injectable, signal } from '@angular/core';

/**
 * Voice & Video device/processing preferences. Device ids are the browser's `MediaDeviceInfo`
 * ids; null = the system default. The audio-processing flags feed the capture constraints of the
 * NEXT connect (livekit-client applies them at track creation); device ids also apply live
 * mid-call via `Room.switchActiveDevice` (VoiceService handles that).
 */
export interface VoicePrefs {
  micDeviceId: string | null;
  speakerDeviceId: string | null;
  cameraDeviceId: string | null;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

const STORAGE_KEY = 'harmony-voice-prefs';

const DEFAULTS: VoicePrefs = {
  micDeviceId: null,
  speakerDeviceId: null,
  cameraDeviceId: null,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

/**
 * localStorage-backed Voice & Video preferences (same persistence pattern as ThemeService — a
 * purely client-side preference, never sent to the API). Exposed as one readonly signal; every
 * setter persists immediately.
 */
@Injectable({ providedIn: 'root' })
export class VoicePrefsService {
  private readonly _prefs = signal<VoicePrefs>(load());
  readonly prefs = this._prefs.asReadonly();

  setMicDevice(deviceId: string | null): void {
    this.patch({ micDeviceId: deviceId });
  }

  setSpeakerDevice(deviceId: string | null): void {
    this.patch({ speakerDeviceId: deviceId });
  }

  setCameraDevice(deviceId: string | null): void {
    this.patch({ cameraDeviceId: deviceId });
  }

  setNoiseSuppression(on: boolean): void {
    this.patch({ noiseSuppression: on });
  }

  setEchoCancellation(on: boolean): void {
    this.patch({ echoCancellation: on });
  }

  setAutoGainControl(on: boolean): void {
    this.patch({ autoGainControl: on });
  }

  private patch(changes: Partial<VoicePrefs>): void {
    const next = { ...this._prefs(), ...changes };
    this._prefs.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage full/blocked — the in-memory preference still applies this session
    }
  }
}

/** Reads persisted prefs, tolerating an absent/corrupt entry (missing fields get defaults). */
function load(): VoicePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<VoicePrefs>) };
  } catch {
    return DEFAULTS;
  }
}
