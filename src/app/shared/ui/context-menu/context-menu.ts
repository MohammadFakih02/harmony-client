import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { ContextMenuService } from '../../../core/services/context-menu.service';
import { ContextMenuEntry, ContextMenuItem, isSeparator } from '../../../core/models/context-menu.models';
import { ViewportService } from '../../../core/services/viewport.service';
import { LONG_PRESS_DEFAULTS, createLongPressTracker } from '../../util/long-press';

/**
 * Single context-menu host, mounted once in the shell. Reads `ContextMenuService.state()` and renders
 * the entries at the cursor: a fixed backdrop catches the next click/right-click to dismiss, the menu
 * is clamped into the viewport after render, and items with `children` reveal a one-level submenu on
 * hover (flipped leftward near the right edge). Checkable items keep the menu open so several can be
 * toggled in a row.
 *
 * On mobile the same state renders as a bottom sheet (submenus expand inline), and this host also owns
 * the app-wide long-press → context-menu bridge for touch: a document-level tracker synthesizes a
 * bubbling `contextmenu` MouseEvent at the touched element after a 500ms hold, so every existing
 * `(contextmenu)` call site works on touch unmodified. Android fires a NATIVE contextmenu on
 * long-press already — the capture-phase listener below arbitrates so exactly one menu opens; iOS
 * never fires one, so the synthetic path is the only path there.
 */
@Component({
  selector: 'app-context-menu',
  standalone: true,
  imports: [NgTemplateOutlet, NgClass],
  templateUrl: './context-menu.html',
})
export class ContextMenu {
  protected readonly contextMenu = inject(ContextMenuService);
  protected readonly viewport = inject(ViewportService);
  protected readonly isSep = isSeparator;
  protected readonly asItem = (e: ContextMenuEntry) => e as ContextMenuItem;

  protected readonly pos = signal({ x: 0, y: 0 });
  protected readonly openLeft = signal(false);
  /** Mobile bottom sheet: index of the entry whose submenu is expanded inline. */
  protected readonly expandedSub = signal<number | null>(null);
  private readonly menuEl = viewChild<ElementRef<HTMLElement>>('menu');

  private readonly press = createLongPressTracker();
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressTarget: Element | null = null;
  /** After a synthetic open, swallow the gesture's trailing ghost click / late native contextmenu. */
  private suppressUntil = 0;

  constructor() {
    // Seed the raw cursor position when a menu opens, then clamp into the viewport next frame once
    // the element has a measurable size. Submenus flip leftward if the menu sits past mid-screen.
    // The mobile sheet is edge-anchored and never uses pos.
    effect(() => {
      const s = this.contextMenu.state();
      this.expandedSub.set(null);
      if (!s || this.viewport.isMobile()) return;
      this.pos.set({ x: s.x, y: s.y });
      this.openLeft.set(s.x > window.innerWidth * 0.6);
      requestAnimationFrame(() => this.clamp());
    });

    // Long-press bridge (touch only). Capture-phase listeners so we run before call-site
    // stopPropagation: a trusted contextmenu mid-press means Android's native long-press won the
    // race — cede to it; one arriving just after our synthetic open is the same gesture echoed —
    // swallow it, as with the ghost click that follows touchend.
    const onContextCapture = (e: MouseEvent): void => {
      if (!e.isTrusted) return;
      if (this.pressTimer) {
        this.cancelPress();
      } else if (Date.now() < this.suppressUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onClickCapture = (e: MouseEvent): void => {
      if (Date.now() < this.suppressUntil) {
        this.suppressUntil = 0;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('contextmenu', onContextCapture, { capture: true });
    document.addEventListener('click', onClickCapture, { capture: true });
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('contextmenu', onContextCapture, { capture: true });
      document.removeEventListener('click', onClickCapture, { capture: true });
      this.cancelPress();
    });
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onPointerDown(e: PointerEvent): void {
    if (!this.viewport.coarsePointer() || e.pointerType !== 'touch') return;
    if (!e.isPrimary) {
      this.cancelPress();
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    // Form fields keep their native touch behavior (selection, paste menu, slider drag), and a
    // press on a CDK backdrop must dismiss its overlay, not open a menu.
    if (!target || target.closest('input, textarea, [contenteditable="true"], .cdk-overlay-backdrop')) return;
    if (!this.press.begin(e.pointerId, e.clientX, e.clientY)) {
      this.clearPressTimer();
      return;
    }
    this.pressTarget = target;
    this.clearPressTimer();
    this.pressTimer = setTimeout(() => this.firePress(), LONG_PRESS_DEFAULTS.delayMs);
  }

  @HostListener('document:pointermove', ['$event'])
  protected onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') this.press.move(e.pointerId, e.clientX, e.clientY);
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  protected cancelPress(): void {
    this.press.cancel();
    this.clearPressTimer();
  }

  private firePress(): void {
    this.pressTimer = null;
    const at = this.press.tryFire();
    const target = this.pressTarget;
    this.pressTarget = null;
    if (!at || !target || !target.isConnected) return;
    this.suppressUntil = Date.now() + 700;
    navigator.vibrate?.(10);
    target.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }),
    );
  }

  private clearPressTimer(): void {
    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
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

  protected async run(item: ContextMenuItem, subIndex?: number): Promise<void> {
    if (item.disabled) return;
    if (item.children?.length) {
      // Mobile sheet: a parent row toggles its inline submenu (hover reveal on desktop).
      if (subIndex !== undefined) this.expandedSub.update((v) => (v === subIndex ? null : subIndex));
      return;
    }
    // Close BEFORE the action runs: actions that open a modal (block/kick/ban confirms) would
    // otherwise leave the menu hanging underneath until the dialog resolves.
    if (!item.keepOpen) this.close();
    await item.action?.();
  }

  /** Live % for a slider row's readout. */
  protected sliderPct(item: ContextMenuItem): number {
    return Math.round((item.slider?.value() ?? 0) * 100);
  }

  protected onSliderInput(item: ContextMenuItem, event: Event): void {
    const pct = Number((event.target as HTMLInputElement).value);
    item.slider?.onInput(pct / 100);
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
    // Mobile: the keyboard opening / URL bar collapsing fires resize — must not dismiss the sheet.
    if (this.viewport.isMobile()) return;
    if (this.contextMenu.state()) this.contextMenu.close();
  }
}
