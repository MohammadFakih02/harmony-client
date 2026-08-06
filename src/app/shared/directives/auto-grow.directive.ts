import { Directive, ElementRef, HostListener, effect, inject, input } from '@angular/core';

/**
 * Auto-grows a <textarea> to fit its content, up to `maxHeight` px, then scrolls.
 *
 * Bind `[autoGrowValue]` to the same value driving the textarea so the height
 * also recalculates on *programmatic* changes (e.g. clearing the draft after
 * send) — the native `input` event only fires on user typing.
 */
@Directive({
  selector: 'textarea[autoGrow]',
  standalone: true,
})
export class AutoGrow {
  readonly maxHeight = input<number>(200);
  readonly autoGrowValue = input<string>('');

  private readonly host = inject<ElementRef<HTMLTextAreaElement>>(ElementRef);

  constructor() {
    // Recalculate when the bound value changes programmatically.
    effect(() => {
      this.autoGrowValue();
      requestAnimationFrame(() => this.adjust());
    });
  }

  @HostListener('input')
  onInput(): void {
    this.adjust();
  }

  private adjust(): void {
    const el = this.host.nativeElement;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, this.maxHeight())}px`;
  }
}
