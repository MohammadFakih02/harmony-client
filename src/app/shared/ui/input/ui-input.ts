import { Component, computed, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'ui-input',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => UiInput),
      multi: true,
    },
  ],
  templateUrl: './ui-input.html',
  host: { style: 'display: block' }
})
export class UiInput implements ControlValueAccessor {
  label      = input('');
  error      = input<string | null>(null);
  inputType  = input('text');
  placeholder = input('');
  autocomplete = input('off');
  inputId    = input('');

  protected value      = signal('');
  protected isDisabled = signal(false);
  protected revealed   = signal(false);

  // Only password fields get the reveal toggle.
  protected isPassword = computed(() => this.inputType() === 'password');
  // The type actually rendered: a revealed password becomes a plain text field.
  protected effectiveType = computed(() =>
    this.isPassword() && this.revealed() ? 'text' : this.inputType()
  );

  protected toggleReveal(): void { this.revealed.update((v) => !v); }

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(val: string): void            { this.value.set(val ?? ''); }
  registerOnChange(fn: (v: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void  { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.isDisabled.set(disabled); }

  protected onInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.value.set(v);
    this.onChange(v);
  }

  protected onBlur(): void { this.onTouched(); }

  // Tailwind class strings must be literal so the scanner detects them.
  protected inputClass = computed(() => {
    const base =
      'w-full px-4 py-2.5 rounded-lg bg-bg border text-primary placeholder-faint text-sm ' +
      'transition-colors duration-150 focus:outline-none focus:ring-1 ' +
      'disabled:opacity-50 disabled:cursor-not-allowed';
    return this.error()
      ? `${base} border-danger focus:border-danger focus:ring-danger`
      : `${base} border-border hover:border-surface-3 focus:border-accent focus:ring-accent`;
  });
}
