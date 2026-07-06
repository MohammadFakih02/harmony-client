import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { AppNotification, NotificationActor, NotificationPayload } from '../models/notification.models';
import { GatewayEvents } from '../hub/gateway-events';
import { NotificationService } from '../services/notification.service';
import { UserService } from '../services/user.service';

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  actors: Record<string, NotificationActor>;
  loading: boolean;
}

export const NotificationStore = signalStore(
  { providedIn: 'root' },
  withState<NotificationState>({ notifications: [], unreadCount: 0, actors: {}, loading: false }),
  withMethods((store, service = inject(NotificationService), userService = inject(UserService)) => {
    // In-flight actor lookups — not reactive state, just a dedup guard.
    const pendingActors = new Set<string>();

    return {
      /** Distributes the bootstrap payload's notification page + badge count (no fetch). */
      set(notifications: AppNotification[], unreadCount: number): void {
        patchState(store, { notifications, unreadCount, loading: false });
      },

      async load(): Promise<void> {
        patchState(store, { loading: true });
        try {
          const [notifications, unreadCount] = await Promise.all([
            service.getNotifications(),
            service.getUnreadCount(),
          ]);
          patchState(store, { notifications, unreadCount });
        } finally {
          patchState(store, { loading: false });
        }
      },

      async markRead(id: string): Promise<void> {
        const target = store.notifications().find((n) => n.id === id);
        if (!target || target.isRead) return;
        patchState(store, {
          notifications: store.notifications().map((n) => (n.id === id ? { ...n, isRead: true } : n)),
          unreadCount: Math.max(0, store.unreadCount() - 1),
        });
        await service.markRead(id).catch(() => {});
      },

      async markAllRead(): Promise<void> {
        patchState(store, {
          notifications: store.notifications().map((n) => ({ ...n, isRead: true })),
          unreadCount: 0,
        });
        await service.markAllRead().catch(() => {});
      },

      /** Removes every notification ("clear all"); optimistic with a fail-open server call. */
      async clearAll(): Promise<void> {
        if (store.notifications().length === 0) return;
        patchState(store, { notifications: [], unreadCount: 0 });
        await service.clearAll().catch(() => {});
      },

      /** Marks every unread `mention`/`reply` for a channel read — used when the user opens it. */
      async markChannelMentionsRead(channelId: string): Promise<void> {
        const targets = store
          .notifications()
          .filter(
            (n) =>
              !n.isRead &&
              (n.type === 'mention' || n.type === 'reply') &&
              n.channelId === channelId,
          );
        if (targets.length === 0) return;
        patchState(store, {
          notifications: store
            .notifications()
            .map((n) => (targets.some((t) => t.id === n.id) ? { ...n, isRead: true } : n)),
          unreadCount: Math.max(0, store.unreadCount() - targets.length),
        });
        await Promise.all(targets.map((t) => service.markRead(t.id).catch(() => {})));
      },

      /** Marks an unread `friend_request` from an actor read — used when it's accepted. */
      async markFriendRequestRead(actorId: string): Promise<void> {
        const target = store
          .notifications()
          .find((n) => !n.isRead && n.type === 'friend_request' && n.actorId === actorId);
        if (!target) return;
        patchState(store, {
          notifications: store
            .notifications()
            .map((n) => (n.id === target.id ? { ...n, isRead: true } : n)),
          unreadCount: Math.max(0, store.unreadCount() - 1),
        });
        await service.markRead(target.id).catch(() => {});
      },

      async delete(id: string): Promise<void> {
        const target = store.notifications().find((n) => n.id === id);
        if (!target) return;
        patchState(store, {
          notifications: store.notifications().filter((n) => n.id !== id),
          unreadCount: target.isRead ? store.unreadCount() : Math.max(0, store.unreadCount() - 1),
        });
        await service.delete(id).catch(() => {});
      },

      // --- SignalR-driven ---

      applyNotificationReceived(payload: NotificationPayload): void {
        if (store.notifications().some((n) => n.id === payload.id)) return;
        patchState(store, {
          notifications: [{ ...payload, isRead: false }, ...store.notifications()],
          unreadCount: store.unreadCount() + 1,
        });
      },

      // --- Actor identity cache (lazy, by id) ---

      async resolveActor(id: string): Promise<void> {
        if (store.actors()[id] || pendingActors.has(id)) return;
        pendingActors.add(id);
        try {
          const actor = await userService.getById(id);
          patchState(store, { actors: { ...store.actors(), [id]: actor } });
        } catch {
          // Fail open with a placeholder so a bad/deleted actor id doesn't retry every render.
          patchState(store, {
            actors: { ...store.actors(), [id]: { id, username: 'Unknown User', avatarKey: null } },
          });
        } finally {
          pendingActors.delete(id);
        }
      },
    };
  }),
  withHooks({
    // Persist incoming notifications off the gateway stream. The location-aware follow-up (suppress
    // + mark-read a mention for the channel you're viewing, else raise the toast) stays in the shell.
    onInit(store, gateway = inject(GatewayEvents)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        if (e.type === 'NotificationReceived') store.applyNotificationReceived(e.payload);
      });
    },
  }),
);
