import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Age-restricted (NSFW) channel gate — a full-panel consent screen shown in place of the message
 * list until the viewer confirms they're of age (consent is remembered per channel by
 * NsfwConsentService). "Continue" reveals the channel; "Go Back" navigates away.
 */
@Component({
  selector: 'app-nsfw-gate',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex-1 min-h-0 flex items-center justify-center px-6' },
  template: `
    <div class="flex flex-col items-center text-center max-w-sm gap-3">
      <div
        class="w-16 h-16 rounded-full bg-danger/15 text-danger flex items-center justify-center"
      >
        <i class="fas fa-triangle-exclamation text-2xl"></i>
      </div>
      <h2 class="text-lg font-bold text-primary">#{{ channelName() }} is age-restricted</h2>
      <p class="text-sm text-muted">
        This channel is marked as age-restricted (NSFW). Please confirm you are at least 18 years old
        and willing to see content that may be sensitive.
      </p>
      <div class="flex gap-2 mt-2">
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-primary hover:bg-surface-2 transition-micro"
          (click)="back.emit()"
        >
          Go Back
        </button>
        <button
          type="button"
          class="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent-hover transition-micro"
          (click)="confirm.emit()"
        >
          I'm of age — Continue
        </button>
      </div>
    </div>
  `,
})
export class NsfwGate {
  readonly channelName = input('channel');
  readonly confirm = output<void>();
  readonly back = output<void>();
}
