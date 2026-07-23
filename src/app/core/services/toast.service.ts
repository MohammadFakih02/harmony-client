import { Injectable, signal } from '@angular/core';
import { NavigationExtras } from '@angular/router';

export interface Toast {
  id: number;
  icon: string;
  title: string;
  body: string | null;
  route: unknown[] | null; // router commands to navigate to when the toast is clicked
  extras?: NavigationExtras; // optional navigation extras (e.g. queryParams) for the route
}

/**
 * Minimal transient-toast service. Toasts auto-dismiss after a TTL; clicking one navigates to its
 * route (if any). Mention toasts are aggregated: rapid-fire mentions collapse into a single
 * "You were mentioned N times" toast that resets its own timer rather than stacking up.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private static readonly TTL = 5000;

  readonly toasts = signal<Toast[]>([]);

  private nextId = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  // The currently-aggregating mention toast (so repeats bump the count instead of stacking).
  private mention: { id: number; count: number } | null = null;

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts.update((t) => t.filter((x) => x.id !== id));
    if (this.mention?.id === id) this.mention = null;
  }

  /**
   * A mention arrived for a channel you're not viewing. `direct` = a 1:1 DM, where the name is a
   * person, so it reads "by {name}"; everywhere else (guild channels, group DMs) the name is a
   * place, so it reads "in {name}".
   */
  pushMention(channelName: string | null, route: unknown[], direct = false): void {
    const count = (this.mention?.count ?? 0) + 1;
    const title = count === 1 ? 'You were mentioned' : `You were mentioned ${count} times`;
    const body = count === 1 && channelName ? `${direct ? 'by' : 'in'} ${channelName}` : null;

    if (this.mention && this.toasts().some((t) => t.id === this.mention!.id)) {
      const id = this.mention.id;
      this.mention.count = count;
      this.toasts.update((t) => t.map((x) => (x.id === id ? { ...x, title, body, route } : x)));
      this.arm(id);
    } else {
      const id = this.push({ icon: 'fa-at', title, body, route });
      this.mention = { id, count };
    }
  }

  /** A reply arrived for a channel you're not viewing — a routed toast (not aggregated). */
  pushReply(actorName: string, channelName: string | null, route: unknown[]): void {
    this.push({
      icon: 'fa-reply',
      title: `${actorName} replied to you`,
      body: channelName ? `in ${channelName}` : null,
      route,
    });
  }

  /** A transient, non-routed confirmation toast (e.g. "Copied to clipboard"). */
  info(title: string, icon = 'fa-check'): void {
    this.push({ icon, title, body: null, route: null });
  }

  /** A routed confirmation toast (e.g. "Server moved to Trash"); clicking follows the route. */
  action(title: string, body: string | null, icon: string, route: unknown[], extras?: NavigationExtras): void {
    this.push({ icon, title, body, route, extras });
  }

  private push(toast: Omit<Toast, 'id'>): number {
    const id = ++this.nextId;
    this.toasts.update((t) => [...t, { ...toast, id }]);
    this.arm(id);
    return id;
  }

  /** (Re)starts the auto-dismiss timer for a toast. */
  private arm(id: number): void {
    const existing = this.timers.get(id);
    if (existing) clearTimeout(existing);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), ToastService.TTL),
    );
  }
}
