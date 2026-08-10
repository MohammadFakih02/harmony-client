import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  ScreenShareFps,
  ScreenShareResolution,
  VoicePrefsService,
} from '../../../core/services/voice-prefs.service';
import { VoiceService } from '../../../core/services/voice.service';
import { SettingsToggle } from '../ui/settings-toggle';

/**
 * Voice & Video preferences — device pickers (mic / speakers / camera) and the audio-processing
 * toggles. Preferences are client-side only (localStorage via VoicePrefsService). Device changes
 * apply live to an active call (`switchActiveDevice`); the processing toggles apply on the next
 * join (they're capture constraints, fixed at track creation). Device labels are only available
 * once the browser has granted a media permission — un-labelled entries render as generic names.
 */
@Component({
  selector: 'app-voice-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SettingsToggle],
  template: `
    <header class="mb-6">
      <h2 class="font-display text-2xl font-bold text-primary tracking-[-0.01em]">Voice &amp; Video</h2>
      <p class="text-sm text-muted mt-1.5">Pick your devices and tune how your mic and screen share sound and look.</p>
    </header>

    <div class="flex items-center justify-between mb-2">
      <p class="set-section-label">Devices</p>
      <button
        type="button"
        class="text-xs font-medium text-muted hover:text-primary transition-micro"
        (click)="loadDevices()"
      >
        <i class="fas fa-rotate mr-1"></i>Refresh
      </button>
    </div>
    <div class="set-card mb-6">
      <div class="set-row">
        <label class="set-row-title shrink-0" for="voice-mic">Input Device</label>
        <select
          id="voice-mic"
          class="max-w-[58%] min-w-0 px-3 py-1.5 rounded-lg bg-surface border border-border-subtle text-sm text-primary focus:outline-none focus:border-accent transition-micro"
          [value]="prefs.prefs().micDeviceId ?? ''"
          (change)="onDevice('audioinput', $event)"
        >
          <option value="">Default</option>
          @for (d of mics(); track d.deviceId) {
          <option [value]="d.deviceId">{{ d.label || 'Microphone' }}</option>
          }
        </select>
      </div>
      <div class="set-row">
        <label class="set-row-title shrink-0" for="voice-speaker">Output Device</label>
        <select
          id="voice-speaker"
          class="max-w-[58%] min-w-0 px-3 py-1.5 rounded-lg bg-surface border border-border-subtle text-sm text-primary focus:outline-none focus:border-accent transition-micro"
          [value]="prefs.prefs().speakerDeviceId ?? ''"
          (change)="onDevice('audiooutput', $event)"
        >
          <option value="">Default</option>
          @for (d of speakers(); track d.deviceId) {
          <option [value]="d.deviceId">{{ d.label || 'Speakers' }}</option>
          }
        </select>
      </div>
      <div class="set-row">
        <label class="set-row-title shrink-0" for="voice-camera">Camera</label>
        <select
          id="voice-camera"
          class="max-w-[58%] min-w-0 px-3 py-1.5 rounded-lg bg-surface border border-border-subtle text-sm text-primary focus:outline-none focus:border-accent transition-micro"
          [value]="prefs.prefs().cameraDeviceId ?? ''"
          (change)="onDevice('videoinput', $event)"
        >
          <option value="">Default</option>
          @for (d of cameras(); track d.deviceId) {
          <option [value]="d.deviceId">{{ d.label || 'Camera' }}</option>
          }
        </select>
      </div>
    </div>

    <p class="set-section-label mb-1">Audio Processing</p>
    <p class="text-2xs text-faint mb-2">Changes apply the next time you join a call.</p>
    <div class="set-card divide-y divide-border-subtle mb-6">
      <app-settings-toggle
        label="Noise Suppression"
        description="Filter out background noise from your microphone."
        [checked]="prefs.prefs().noiseSuppression"
        (toggled)="prefs.setNoiseSuppression($event)"
      />
      <app-settings-toggle
        label="Echo Cancellation"
        description="Prevent your speakers from echoing back into your mic."
        [checked]="prefs.prefs().echoCancellation"
        (toggled)="prefs.setEchoCancellation($event)"
      />
      <app-settings-toggle
        label="Automatic Gain Control"
        description="Keep your voice at a steady volume automatically."
        [checked]="prefs.prefs().autoGainControl"
        (toggled)="prefs.setAutoGainControl($event)"
      />
    </div>

    <p class="set-section-label mb-1">Screen Share</p>
    <p class="text-2xs text-faint mb-2">Applies the next time you start sharing. Lower settings use less bandwidth.</p>
    <div class="set-card">
      <div class="set-row">
        <label class="set-row-title shrink-0" for="voice-ss-res">Resolution</label>
        <select
          id="voice-ss-res"
          class="max-w-[58%] min-w-0 px-3 py-1.5 rounded-lg bg-surface border border-border-subtle text-sm text-primary focus:outline-none focus:border-accent transition-micro"
          [value]="prefs.prefs().screenShareResolution"
          (change)="onScreenRes($event)"
        >
          <option value="720p">720p — higher quality</option>
          <option value="480p">480p — saves bandwidth</option>
        </select>
      </div>
      <div class="set-row">
        <label class="set-row-title shrink-0" for="voice-ss-fps">Frame Rate</label>
        <select
          id="voice-ss-fps"
          class="max-w-[58%] min-w-0 px-3 py-1.5 rounded-lg bg-surface border border-border-subtle text-sm text-primary focus:outline-none focus:border-accent transition-micro"
          [value]="prefs.prefs().screenShareFps"
          (change)="onScreenFps($event)"
        >
          <option value="30">30 fps — smoother motion</option>
          <option value="15">15 fps — saves bandwidth</option>
        </select>
      </div>
    </div>
  `,
})
export class VoiceSettings {
  protected readonly prefs = inject(VoicePrefsService);
  private readonly voice = inject(VoiceService);

  protected readonly mics = signal<MediaDeviceInfo[]>([]);
  protected readonly speakers = signal<MediaDeviceInfo[]>([]);
  protected readonly cameras = signal<MediaDeviceInfo[]>([]);

  constructor() {
    void this.loadDevices();
  }

  protected async loadDevices(): Promise<void> {
    const [mics, speakers, cameras] = await Promise.all([
      this.voice.listDevices('audioinput'),
      this.voice.listDevices('audiooutput'),
      this.voice.listDevices('videoinput'),
    ]);
    this.mics.set(mics);
    this.speakers.set(speakers);
    this.cameras.set(cameras);
  }

  /** Persists the pick ('' = system default) and applies it live if a call is active. */
  protected onDevice(kind: MediaDeviceKind, event: Event): void {
    const value = (event.target as HTMLSelectElement).value || null;
    if (kind === 'audioinput') this.prefs.setMicDevice(value);
    else if (kind === 'audiooutput') this.prefs.setSpeakerDevice(value);
    else this.prefs.setCameraDevice(value);
    void this.voice.switchActiveDevice(kind, value);
  }

  protected onScreenRes(event: Event): void {
    this.prefs.setScreenShareResolution((event.target as HTMLSelectElement).value as ScreenShareResolution);
  }

  protected onScreenFps(event: Event): void {
    this.prefs.setScreenShareFps(Number((event.target as HTMLSelectElement).value) as ScreenShareFps);
  }
}
