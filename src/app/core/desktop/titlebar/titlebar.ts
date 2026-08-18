import { Component } from '@angular/core';

// Frameless-window titlebar for the desktop (Tauri) build. Rendered only under Tauri
// (see App / app.html). The drag region uses Tauri's `data-tauri-drag-region` (no JS);
// the buttons dynamically import @tauri-apps/api so the package stays OFF the web eager
// bundle while the component itself renders synchronously. Styled with the app's own
// theme tokens so it follows every palette × mode. Height is h-8 (2rem) — kept in sync
// with the reservation rule in styles.css.
@Component({
  selector: 'app-titlebar',
  standalone: true,
  template: `
    <div
      class="fixed inset-x-0 top-0 h-8 z-[9999] flex items-stretch bg-bg border-b border-border select-none"
    >
      <div
        class="flex-1 flex items-center px-3 text-xs font-medium text-faint"
        data-tauri-drag-region
      >
        Harmony
      </div>
      <div class="flex items-stretch">
        <button
          type="button"
          class="w-11 grid place-items-center text-faint hover:bg-surface-2 hover:text-primary transition-colors"
          aria-label="Minimize"
          (click)="minimize()"
        >
          <i class="fa-solid fa-minus text-[11px]"></i>
        </button>
        <button
          type="button"
          class="w-11 grid place-items-center text-faint hover:bg-surface-2 hover:text-primary transition-colors"
          aria-label="Maximize"
          (click)="toggleMaximize()"
        >
          <i class="fa-regular fa-square text-[10px]"></i>
        </button>
        <button
          type="button"
          class="w-11 grid place-items-center text-faint hover:bg-red-600 hover:text-white transition-colors"
          aria-label="Close"
          (click)="close()"
        >
          <i class="fa-solid fa-xmark text-[13px]"></i>
        </button>
      </div>
    </div>
  `,
})
export class Titlebar {
  private async win() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow();
  }
  async minimize() {
    (await this.win()).minimize();
  }
  async toggleMaximize() {
    (await this.win()).toggleMaximize();
  }
  async close() {
    (await this.win()).close();
  }
}
