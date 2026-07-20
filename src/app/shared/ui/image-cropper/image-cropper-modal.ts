import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { UiButton } from '../button/ui-button';
import { UiModal } from '../modal/ui-modal';
import {
  CropRect,
  clampRect,
  displayToNatural,
  exportSize,
  initialCropRect,
  scaleRectAboutCenter,
} from './crop-math';

const MIN_CROP_DISPLAY_PX = 32;
const STAGE_MAX_HEIGHT_PX = 320;

/**
 * Steam-style crop modal for avatar/banner selection: the source image is letterboxed on a stage,
 * a fixed-aspect crop rect is dragged (Pointer Events + capture) and resized (wheel or the zoom
 * slider, always about its centre), with a live preview rendered exactly as the asset will appear.
 * Confirm draws the selected region once to an offscreen canvas — capped at `outputWidth`, never
 * upscaled — and emits a `File` so the existing presign → PUT → confirm flow runs unchanged.
 * PNG stays PNG (alpha); everything else exports as JPEG q0.9 (no WebP — Safari's toBlob gap).
 * All geometry lives in crop-math.ts (pure, unit-tested); this component only wires events.
 */
@Component({
  selector: 'app-image-cropper-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiModal],
  templateUrl: './image-cropper-modal.html',
})
export class ImageCropperModal implements OnDestroy {
  file = input.required<File>();
  /** Crop aspect ratio (w / h): 1 for avatars, 3.5 for banners. */
  aspect = input(1);
  /** Longest exported width in pixels (512 avatar / 1280 banner). */
  outputWidth = input(512);
  heading = input('Crop Image');

  cropped = output<File>();
  close = output<void>();

  private readonly stage = viewChild<ElementRef<HTMLDivElement>>('stage');

  protected readonly objectUrl = signal<string | null>(null);
  protected readonly displayW = signal(0);
  protected readonly displayH = signal(0);
  protected readonly rect = signal<CropRect>({ x: 0, y: 0, w: 0, h: 0 });
  protected readonly exporting = signal(false);
  protected readonly loadError = signal(false);

  private bitmap: ImageBitmap | null = null;
  private dragStart: { px: number; py: number; rx: number; ry: number } | null = null;

  /** Slider position ∈ [0, 100]: 0 = widest selection (zoomed out), 100 = smallest (zoomed in). */
  protected readonly zoomValue = computed(() => {
    const { minW, maxW } = this.zoomBounds();
    if (maxW <= minW) return 0;
    return Math.round((1 - (this.rect().w - minW) / (maxW - minW)) * 100);
  });

  /** Avatar previews render round at 80×80; banners as a 210-wide strip of the same aspect. */
  protected readonly previewW = computed(() => (this.aspect() === 1 ? 80 : 210));
  protected readonly previewH = computed(() => this.previewW() / this.aspect());
  protected readonly previewStyle = computed(() => {
    const url = this.objectUrl();
    const r = this.rect();
    if (!url || r.w <= 0) return null;
    const scale = this.previewW() / r.w;
    return {
      'background-image': `url(${url})`,
      'background-size': `${this.displayW() * scale}px ${this.displayH() * scale}px`,
      'background-position': `${-r.x * scale}px ${-r.y * scale}px`,
    };
  });

  constructor() {
    effect((onCleanup) => {
      const file = this.file();
      const url = URL.createObjectURL(file);
      this.objectUrl.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
      void this.loadBitmap(file);
    });
  }

  ngOnDestroy(): void {
    this.bitmap?.close();
    this.bitmap = null;
  }

  private async loadBitmap(file: File): Promise<void> {
    try {
      // 'from-image' applies EXIF orientation, matching how the <img> preview renders.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (file !== this.file()) {
        bitmap.close();
        return;
      }
      this.bitmap?.close();
      this.bitmap = bitmap;
      this.layoutStage();
    } catch {
      this.loadError.set(true);
    }
  }

  /** Letterboxes the bitmap into the stage width × max height and seeds the crop rect. */
  private layoutStage(): void {
    const bitmap = this.bitmap;
    const stageEl = this.stage()?.nativeElement;
    if (!bitmap) return;
    if (!stageEl || stageEl.clientWidth === 0) {
      // The view (or its layout) isn't ready yet — retry on the next frame.
      requestAnimationFrame(() => this.layoutStage());
      return;
    }
    const scale = Math.min(stageEl.clientWidth / bitmap.width, STAGE_MAX_HEIGHT_PX / bitmap.height);
    const w = Math.max(1, Math.floor(bitmap.width * scale));
    const h = Math.max(1, Math.floor(bitmap.height * scale));
    this.displayW.set(w);
    this.displayH.set(h);
    this.rect.set(initialCropRect(w, h, this.aspect()));
  }

  // ---- drag to move -----------------------------------------------------

  protected onRectPointerDown(event: PointerEvent): void {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const r = this.rect();
    this.dragStart = { px: event.clientX, py: event.clientY, rx: r.x, ry: r.y };
  }

  protected onRectPointerMove(event: PointerEvent): void {
    const start = this.dragStart;
    if (!start) return;
    const r = this.rect();
    this.rect.set(
      clampRect(
        {
          x: start.rx + (event.clientX - start.px),
          y: start.ry + (event.clientY - start.py),
          w: r.w,
          h: r.h,
        },
        this.displayW(),
        this.displayH(),
      ),
    );
  }

  protected onRectPointerUp(): void {
    this.dragStart = null;
  }

  // ---- zoom (wheel + slider), always about the rect centre --------------

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.scaleBy(event.deltaY < 0 ? 1 / 1.06 : 1.06);
  }

  protected onZoomInput(event: Event): void {
    const t = Number((event.target as HTMLInputElement).value) / 100;
    const { minW, maxW } = this.zoomBounds();
    const targetW = maxW - (maxW - minW) * t;
    const current = this.rect().w;
    if (current > 0) this.scaleBy(targetW / current);
  }

  private scaleBy(factor: number): void {
    this.rect.set(
      scaleRectAboutCenter(
        this.rect(),
        factor,
        this.aspect(),
        this.displayW(),
        this.displayH(),
        MIN_CROP_DISPLAY_PX,
      ),
    );
  }

  private zoomBounds(): { minW: number; maxW: number } {
    const maxW = Math.min(this.displayW(), this.displayH() * this.aspect());
    return { minW: Math.min(MIN_CROP_DISPLAY_PX, maxW), maxW };
  }

  // ---- export -----------------------------------------------------------

  protected async confirm(): Promise<void> {
    const bitmap = this.bitmap;
    const r = this.rect();
    if (!bitmap || r.w <= 0 || this.exporting()) return;
    this.exporting.set(true);
    try {
      const natural = displayToNatural(r, bitmap.width / this.displayW());
      const { w, h } = exportSize(natural, this.outputWidth(), this.aspect());

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, natural.x, natural.y, natural.w, natural.h, 0, 0, w, h);

      const source = this.file();
      const isPng = source.type === 'image/png';
      const type = isPng ? 'image/png' : 'image/jpeg';
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, isPng ? undefined : 0.9),
      );
      if (!blob) throw new Error('toBlob failed');

      const baseName = source.name.replace(/\.[^.]+$/, '') || 'image';
      this.cropped.emit(new File([blob], `${baseName}${isPng ? '.png' : '.jpg'}`, { type }));
    } catch {
      this.loadError.set(true);
    } finally {
      this.exporting.set(false);
    }
  }
}
