import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Confirm-button label (default "Confirm"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button destructive-red. */
  danger?: boolean;
  /** Optional free-text field (e.g. a ban reason); its value comes back on the result.
   *  `value` pre-fills it (the window.prompt default-value equivalent). */
  input?: { label?: string; placeholder?: string; value?: string };
}

export interface NoticeOptions {
  title: string;
  message: string;
  okLabel?: string;
}

/** Truthy when confirmed; `input` carries the optional text field's value ('' when absent). */
export interface ConfirmResult {
  input: string;
}

interface ActiveDialog {
  kind: 'confirm' | 'notice';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  input: { label?: string; placeholder?: string; value?: string } | null;
  resolve: (result: ConfirmResult | null) => void;
}

/**
 * App-wide in-app replacement for window.confirm/alert. The host component
 * (app-confirm-dialog, mounted once in the shell) renders whatever this holds;
 * any code can await `confirm()`/`notice()`.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _active = signal<ActiveDialog | null>(null);
  readonly active = this._active.asReadonly();

  /** Resolves truthy (a {@link ConfirmResult}) on confirm, `null` on cancel/dismiss. */
  confirm(opts: ConfirmOptions): Promise<ConfirmResult | null> {
    return new Promise((resolve) => {
      // A second request while one is open cancels the first (shouldn't happen in practice).
      this._active()?.resolve(null);
      this._active.set({
        kind: 'confirm',
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        danger: opts.danger ?? false,
        input: opts.input ?? null,
        resolve,
      });
    });
  }

  /** Single-OK informational dialog (the window.alert replacement). */
  notice(opts: NoticeOptions): Promise<void> {
    return new Promise((resolve) => {
      this._active()?.resolve(null);
      this._active.set({
        kind: 'notice',
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.okLabel ?? 'OK',
        cancelLabel: '',
        danger: false,
        input: null,
        resolve: () => resolve(),
      });
    });
  }

  /** Called by the host dialog. */
  settle(result: ConfirmResult | null): void {
    const active = this._active();
    this._active.set(null);
    active?.resolve(result);
  }
}
