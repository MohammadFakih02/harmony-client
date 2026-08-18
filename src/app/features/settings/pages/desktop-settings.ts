import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DesktopSettingsService } from '../../../core/desktop/desktop-settings.service';
import { AutostartService } from '../../../core/desktop/autostart.service';
import { SettingsToggle } from '../ui/settings-toggle';

/** Desktop-app-only settings pane (rendered only under Tauri; see Settings nav gating). */
@Component({
  selector: 'app-desktop-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SettingsToggle],
  template: `
    <header class="mb-6">
      <h2 class="font-display text-2xl font-bold text-primary tracking-[-0.01em]">Desktop</h2>
      <p class="text-sm text-muted mt-1.5">Settings for the Harmony desktop app.</p>
    </header>

    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Window</p>
    <div class="rounded-xl border border-border-subtle overflow-hidden mb-8">
      <app-settings-toggle
        label="Close to tray"
        description="Keep Harmony running in the system tray when you close the window, instead of quitting. Restore it any time from the tray icon."
        [checked]="desktop.closeToTray()"
        (toggled)="desktop.setCloseToTray($event)"
      />
    </div>

    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Startup</p>
    <div class="rounded-xl border border-border-subtle overflow-hidden mb-8">
      <app-settings-toggle
        label="Open Harmony on startup"
        description="Launch Harmony automatically when you sign in to Windows. It starts minimized in the tray."
        [checked]="autostart.enabled()"
        (toggled)="autostart.set($event)"
      />
    </div>

    <p class="text-2xs font-bold uppercase tracking-wider text-faint mb-2">Activity</p>
    <div class="rounded-xl border border-border-subtle overflow-hidden">
      <app-settings-toggle
        label="Display current game as status"
        description="When you're playing a detected game, show it as your custom status (Playing …) so friends can see it. Restores your previous status when you stop."
        [checked]="desktop.gameActivity()"
        (toggled)="desktop.setGameActivity($event)"
      />
    </div>
  `,
})
export class DesktopSettings {
  protected readonly desktop = inject(DesktopSettingsService);
  protected readonly autostart = inject(AutostartService);
}
