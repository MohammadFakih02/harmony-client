import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  computed,
  input,
  output,
} from '@angular/core';

/**
 * Shared modal shell: dimmed blurred backdrop, centred card, optional centred heading/subtitle,
 * a top-right ✕, backdrop-click and Escape to close (topmost modal only, so stacked modals close
 * one at a time). Content is projected unpadded — each modal brings its own sections (px-6 …).
 */
@Component({
  selector: 'ui-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-modal.html',
})
export class UiModal implements OnDestroy {
  heading = input('');
  subtitle = input('');
  size = input<'xs' | 'sm' | 'md' | 'lg'>('sm');
  /** 'top' renders above an already-open modal (z-60 vs z-50). */
  layer = input<'base' | 'top'>('base');
  close = output<void>();

  protected readonly sizeClass = computed(
    () => ({ xs: 'max-w-xs', sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' })[this.size()],
  );

  // Escape must close only the topmost open modal.
  private static stack: UiModal[] = [];

  constructor() {
    UiModal.stack.push(this);
  }

  ngOnDestroy(): void {
    UiModal.stack = UiModal.stack.filter((m) => m !== this);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (UiModal.stack[UiModal.stack.length - 1] === this) this.close.emit();
  }
}
