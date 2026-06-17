import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';

/**
 * Focuses the host once it's rendered and places the caret at the end of any existing
 * value. Used for the inline message-edit textarea so editing begins immediately without
 * a manual click. Fires on view init, which is when the element enters the DOM (e.g. when
 * an `@if` reveals it).
 */
@Directive({
  selector: '[autofocusEnd]',
  standalone: true,
})
export class AutofocusEnd implements AfterViewInit {
  private readonly host = inject<ElementRef<HTMLTextAreaElement | HTMLInputElement>>(ElementRef);

  ngAfterViewInit(): void {
    const el = this.host.nativeElement;
    el.focus();
    const len = el.value?.length ?? 0;
    el.setSelectionRange?.(len, len);
  }
}
