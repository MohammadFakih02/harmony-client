import { Injectable, signal } from '@angular/core';
import { ContextMenuEntry } from '../models/context-menu.models';

interface ContextMenuState {
  x: number;
  y: number;
  entries: ContextMenuEntry[];
}

/**
 * Signal-driven context-menu service (mirrors ToastService). Call `open(event, entries)` from a
 * `(contextmenu)` handler; a single `<app-context-menu>` host mounted in the shell renders the menu
 * at the cursor. Opening a new menu replaces any open one, so right-clicking elsewhere just moves it.
 */
@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  readonly state = signal<ContextMenuState | null>(null);

  open(event: MouseEvent, entries: ContextMenuEntry[]): void {
    event.preventDefault();
    event.stopPropagation();
    if (entries.length === 0) return;
    this.state.set({ x: event.clientX, y: event.clientY, entries });
  }

  close(): void {
    this.state.set(null);
  }
}
