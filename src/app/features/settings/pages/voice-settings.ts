import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { VoicePrefsService } from '../../../core/services/voice-prefs.service';
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
    <h2 class="text-xl font-bold text-primary mb-5">Voice & Video</h2>

    <div class="flex flex-col gap-4 mb-6">
      <div class="flex flex-col gap-1.5">
        <label class="text-2xs font-bold uppercase tracking-wider text-faint" for="voice-mic">
          Input Device
        </label>
        <select
          id="voice-mic"
          class="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-sm text-primary focus:outline-none focus:border-accent transition-micro"
          [value]="prefs.prefs().micDeviceId ?? ''"
          (change)="onDevice('audioinput', $event)"
        >
          <option value="">Default</option>
          @for (d of mics(); track d.deviceId) {
          <option [value]="d.deviceId">{{ d.label || 'Microphone' }}</option>
          }
        </select>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-2xs font-bold uppercase tracking-wider text-faint" for="voice-speaker">
          Output Device
        </label>
        <select
          id="voice-speaker"
          class="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-sm text-primary focus:outline-none focus:border-accent transition-micro"
          [value]="prefs.prefs().speakerDeviceId ?? ''"
          (change)="onDevice('audiooutput', $event)"
        >
          <option value="">Default</option>
          @for (d of speakers(); track d.deviceId) {
          <option [value]="d.deviceId">{{ d.label || 'Speakers' }}</option>
          }
        </select>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-2xs font-bold uppercase tracking-wider text-faint" for="voice-camera">
          Camera
        </label>
        <select
          id="voice-camera"
          class="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-sm text-primary focus:outline-none focus:border-accent transition-micro"
          [value]="prefs.prefs().cameraDeviceId ?? ''"
          (change)="onDevice('videoinput', $event)"
        >
          <option value="">Default</option>
          @for (d of cameras(); track d.deviceId) {
          <option [value]="d.deviceId">{{ d.label || 'Camera' }}</option>
          }
        </select>
      </div>

      <button
        type="button"
        class="self-start text-xs font-medium text-muted hover:text-primary transition-micro"
        (click)="loadDevices()"
      >
        <i class="fas fa-rotate mr-1"></i>Refresh devices
      </button>
    </div>

    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-1">Audio Processing</p>
    <p class="text-2xs text-faint mb-2">Changes apply the next time you join a call.</p>
    <div class="divide-y divide-border-subtle">
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
}
