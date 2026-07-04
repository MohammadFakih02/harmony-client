import { Directive, ElementRef, inject, input, output } from '@angular/core';

/**
 * Pointer-drag handle for resizable panels. Attach to a thin strip along a panel edge:
 *
 *   <div [appResizeHandle]="width()" edge="right" [min]="200" [max]="400"
 *        (widthChange)="setWidth($event)"></div>
 *
 * `appResizeHandle` is the panel's width when the drag starts; `edge` is which edge of the panel
 * the handle sits on (dragging away from the panel grows it). Uses pointer capture, so the drag
 * keeps tracking even when the cursor leaves the strip; a body class suppresses text selection
 * and keeps the col-resize cursor for the duration.
 */
@Directive({
  selector: '[appResizeHandle]',
  standalone: true,
  host: {
    class: 'cursor-col-resize touch-none',
    '(pointerdown)': 'onPointerDown($event)',
  },
})
export class ResizeHandle {
  /** The panel's current width in px (read once, at drag start). */
  readonly width = input.required<number>({ alias: 'appResizeHandle' });
  /** Which edge of the panel this handle sits on. */
  readonly edge = input<'left' | 'right'>('right');
  readonly min = input(200);
  readonly max = input(480);
  readonly widthChange = output<number>();

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = this.el.nativeElement;
    const start = this.width();
    const startX = event.clientX;
    // Handle on the panel's right edge: dragging right grows it. Left edge: dragging left grows it.
    const dir = this.edge() === 'right' ? 1 : -1;

    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('is-col-resizing');

    const onMove = (ev: PointerEvent) => {
      const next = Math.min(this.max(), Math.max(this.min(), start + dir * (ev.clientX - startX)));
      this.widthChange.emit(next);
    };
    const end = (ev: PointerEvent) => {
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.body.classList.remove('is-col-resizing');
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
}
