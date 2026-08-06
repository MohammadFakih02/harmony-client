import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'ui-spinner',
  standalone: true,
  template: `<i class="fas fa-yin-yang animate-spin" [class]="sizeClass()"></i>`,
})
export class UiSpinner {
  size = input<'sm' | 'base' | 'lg'>('base');

  protected sizeClass = computed(() => {
    const map: Record<string, string> = { sm: 'text-sm', base: 'text-base', lg: 'text-xl' };
    return map[this.size()];
  });
}
