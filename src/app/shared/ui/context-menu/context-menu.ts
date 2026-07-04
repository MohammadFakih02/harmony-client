import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { ContextMenuService } from '../../../core/services/context-menu.service';
import { ContextMenuEntry, ContextMenuItem, isSeparator } from '../../../core/models/context-menu.models';

/**
 * Single context-menu host, mounted once in the shell. Reads `ContextMenuService.state()` and renders
 * the entries at the cursor: a fixed backdrop catches the next click/right-click to dismiss, the menu
 * is clamped into the viewport after render, and items with `children` reveal a one-level submenu on
 * hover (flipped leftward near the right edge). Checkable items keep the menu open so several can be
 * toggled in a row.
 */
@Component({
  selector: 'app-context-menu',
  standalone: true,
  imports: [NgTemplateOutlet, NgClass],
  templateUrl: './context-menu.html',
})
export class ContextMenu {
  protected readonly contextMenu = inject(ContextMenuService);
  protected readonly isSep = isSeparator;
  protected readonly asItem = (e: ContextMenuEntry) => e as ContextMenuItem;

  protected readonly pos = signal({ x: 0, y: 0 });
  protected readonly openLeft = signal(false);
  private readonly menuEl = viewChild<ElementRef<HTMLElement>>('menu');

  constructor() {
    // Seed the raw cursor position when a menu opens, then clamp into the viewport next frame once
    // the element has a measurable size. Submenus flip leftward if the menu sits past mid-screen.
    effect(() => {
      const s = this.contextMenu.state();
      if (!s) return;
      this.pos.set({ x: s.x, y: s.y });
      this.openLeft.set(s.x > window.innerWidth * 0.6);
      requestAnimationFrame(() => this.clamp());
    });
  }

  private clamp(): void {
    const el = this.menuEl()?.nativeElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let { x, y } = this.pos();
    if (x + r.width + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - r.width - pad);
    if (y + r.height + pad > window.innerHeight) y = Math.max(pad, window.innerHeight - r.height - pad);
    this.pos.set({ x, y });
  }

  protected async run(item: ContextMenuItem): Promise<void> {
    if (item.disabled || item.children?.length) return;
    try {
      await item.action?.();
    } finally {
      if (!item.keepOpen) this.close();
    }
  }

  protected close(event?: Event): void {
    event?.preventDefault();
    this.contextMenu.close();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.contextMenu.state()) this.contextMenu.close();
  }

  @HostListener('window:resize')
  @HostListener('window:wheel')
  protected onViewportChange(): void {
    if (this.contextMenu.state()) this.contextMenu.close();
  }
}
