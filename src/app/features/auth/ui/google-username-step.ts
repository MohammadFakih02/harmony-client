import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiButton, UiInput } from '../../../shared/ui';

/**
 * The username step of Google sign-up, shared by the login and register pages so the two can't
 * drift apart.
 *
 * Shown when POST /auth/google reports needsUsername — the ID token is valid but matches no
 * account. Nothing exists server-side at this point: no user row, no session. Backing out here
 * leaves no trace, which is exactly why the username is collected BEFORE creation rather than
 * after. Emitting `submitted` re-posts the same ID token together with the chosen name, and that
 * second call is what actually registers the account.
 *
 * Dumb by design: the parent owns the ID token and the service call, so this component never sees
 * a credential.
 */
@Component({
  selector: 'app-google-username-step',
  standalone: true,
  imports: [FormsModule, UiButton, UiInput],
  template: `
    <div class="space-y-4">
      <div class="text-center">
        <p class="text-sm text-muted">
          Signing up as <span class="font-semibold text-primary">{{ email() }}</span>
        </p>
        <p class="text-xs text-faint mt-1">Pick a username — this is how others will see you.</p>
      </div>

      <ui-input
        [(ngModel)]="username"
        label="Username"
        placeholder="username"
        autocomplete="username"
        inputId="google-username"
        [error]="error()"
      />

      <ui-button
        variant="primary"
        class="w-full"
        [disabled]="!valid() || loading()"
        (click)="submit()"
      >
        {{ loading() ? 'Creating account…' : 'Continue' }}
      </ui-button>

      <button
        type="button"
        class="w-full text-xs text-muted hover:text-primary transition-micro"
        (click)="cancelled.emit()"
      >
        Use a different account
      </button>
    </div>
  `,
})
export class GoogleUsernameStep {
  readonly email = input.required<string>();
  /** A name the server confirmed was free, offered as a prefill. The server re-validates whatever
   * comes back, so editing it freely is safe. */
  readonly suggestedUsername = input.required<string>();
  readonly loading = input(false);
  /** Server-side rejection (e.g. the name was taken between the suggestion and submit). Cleared
   * locally as soon as the user edits, so a stale message doesn't sit under a changed value. */
  readonly serverError = input<string | null>(null);

  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  // Re-seeds if the suggestion arrives late or changes, but keeps whatever the user has typed.
  protected readonly username = linkedSignal<string, string>({
    source: () => this.suggestedUsername(),
    computation: (suggestion, previous) => previous?.value || suggestion,
  });

  private readonly touched = signal(false);

  // Mirrors RegisterRequestValidator on the backend (2–32). Kept deliberately loose beyond that:
  // the server owns the real rule, and a stricter client would reject names the server accepts.
  protected readonly valid = computed(() => {
    const v = this.username().trim();
    return v.length >= 2 && v.length <= 32;
  });

  protected readonly error = computed(() => {
    if (this.serverError()) return this.serverError();
    if (!this.touched()) return null;
    return this.valid() ? null : 'Username must be between 2 and 32 characters.';
  });

  protected submit(): void {
    this.touched.set(true);
    if (!this.valid() || this.loading()) return;
    this.submitted.emit(this.username().trim());
  }
}
