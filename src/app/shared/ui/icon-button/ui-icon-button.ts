import { Component, computed, input } from '@angular/core';

/**
 * Square icon-only button. Owns its own sizing, hover, press feedback and
 * focus — nothing global reaches in. Pass the icon as content:
 *
 *   <ui-icon-button size="md" hover="surface-3" label="Settings" (click)="...">
 *     <i class="fas fa-gear"></i>
 *   </ui-icon-button>
 *
 * `display: contents` keeps the host transparent to layout, so the inner
 * <button> becomes the direct flex child of the parent row.
 */
@Component({
  selector: 'ui-icon-button',
  standalone: true,
  templateUrl: './ui-icon-button.html',
  host: { style: 'display: contents' },
})
export class UiIconButton {
  size = input<'xs' | 'sm' | 'md'>('md');
  hover = input<'surface-2' | 'surface-3' | 'none'>('surface-2');
  active = input<boolean>(false);
  label = input<string>('');
  type = input<'button' | 'submit' | 'reset'>('button');
  disabled = input<boolean>(false);

  protected classes = computed(() => {
    // Literal class strings so the Tailwind v4 scanner detects them.
    const sizes: Record<string, string> = {
      xs: 'w-5 h-5 rounded text-xs',
      sm: 'w-7 h-7 rounded-md text-xs',
      md: 'w-8 h-8 rounded-md text-sm',
    };
    const hovers: Record<string, string> = {
      'surface-2': 'hover:bg-surface-2',
      'surface-3': 'hover:bg-surface-3',
      none: '',
    };
    const state = this.active()
      ? 'text-accent bg-accent-muted'
      : 'text-muted hover:text-primary';

    return (
      'inline-flex items-center justify-center shrink-0 transition-micro active:scale-[0.97] ' +
      'disabled:opacity-50 disabled:cursor-not-allowed ' +
      `${sizes[this.size()]} ${hovers[this.hover()]} ${state}`
    );
  });
}
