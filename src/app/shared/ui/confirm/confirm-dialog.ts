import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiModal } from '../modal/ui-modal';
import { ConfirmService } from './confirm.service';

/**
 * Host for {@link ConfirmService} dialogs. Mount once (in the shell); renders above any base
 * modal via the ui-modal 'top' layer. Enter confirms, Escape/backdrop/✕ cancel (via ui-modal).
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiModal, FormsModule],
  template: `
    @if (svc.active(); as dialog) {
    <ui-modal [heading]="dialog.title" size="sm" layer="top" (close)="svc.settle(null)">
      <form class="px-6 pb-5 flex flex-col gap-4" (submit)="$event.preventDefault(); confirm()">
        @if (dialog.message) {
        <p class="text-sm text-muted whitespace-pre-wrap text-center">{{ dialog.message }}</p>
        }

        @if (dialog.input) {
        <label class="flex flex-col gap-1.5">
          @if (dialog.input.label) {
          <span class="text-2xs font-bold uppercase tracking-wider text-faint">
            {{ dialog.input.label }}
          </span>
          }
          <input
            type="text"
            class="w-full h-9 px-3 rounded-lg bg-surface-2 border border-border-subtle text-sm text-primary placeholder:text-faint focus:outline-none focus:border-accent transition-micro"
            [placeholder]="dialog.input.placeholder ?? ''"
            [(ngModel)]="inputValue"
            name="dialogInput"
            autofocus
          />
        </label>
        }

        <div class="flex justify-end gap-2">
          @if (dialog.kind === 'confirm') {
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-primary transition-micro"
            (click)="svc.settle(null)"
          >
            {{ dialog.cancelLabel }}
          </button>
          }
          <button
            type="submit"
            class="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-micro"
            [class]="
              dialog.danger ? 'bg-danger hover:bg-danger/85' : 'bg-accent hover:bg-accent-hover'
            "
          >
            {{ dialog.confirmLabel }}
          </button>
        </div>
      </form>
    </ui-modal>
    }
  `,
})
export class ConfirmDialog {
  protected readonly svc = inject(ConfirmService);
  protected readonly inputValue = signal('');

  constructor() {
    // (Re)seed the text field whenever a new dialog opens.
    effect(() => {
      const active = this.svc.active();
      if (active) this.inputValue.set(active.input?.value ?? '');
    });
  }

  protected confirm(): void {
    this.svc.settle({ input: this.inputValue().trim() });
  }
}
