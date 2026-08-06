import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { MessageResponse, PinnedMessageResponse } from '../models/message.models';
import { GatewayEvents } from '../hub/gateway-events';
import { MessageService } from '../services/message.service';
import { AuthService } from '../services/auth.service';

interface PinState {
  // The channel the currently-held pins belong to (guildId null = DM). Tracked so live
  // pin/unpin events and reloads target the right conversation.
  guildId: string | null;
  channelId: string | null;
  pins: PinnedMessageResponse[];
  loading: boolean;
}

/**
 * Pinned messages for the active channel. Loaded once on channel open (populating `pinnedIds`, which
 * drives the 📌 indicator + Pin/Unpin toggle in the message list) and kept in sync via the
 * MessagePinned / MessageUnpinned SignalR events. Channel-scoped and ephemeral — reset on switch.
 */
export const PinStore = signalStore(
  { providedIn: 'root' },
  withState<PinState>({ guildId: null, channelId: null, pins: [], loading: false }),
  withComputed((store) => ({
    /** Message ids currently pinned in the active channel. */
    pinnedIds: computed(() => new Set(store.pins().map((p) => p.message.messageId))),
  })),
  withMethods((store, service = inject(MessageService), auth = inject(AuthService)) => {
    const isActive = (channelId: string) => store.channelId() === channelId;

    async function reload(): Promise<void> {
      const channelId = store.channelId();
      if (channelId == null) return;
      try {
        const pins = await service.getPins(store.guildId(), channelId);
        if (store.channelId() === channelId) patchState(store, { pins });
      } catch {
        // fail-open: keep the current list; the server stays authoritative
      }
    }

    return {
      /** Load the channel's pins. Called on channel open; resets state when switching channels. */
      async load(guildId: string | null, channelId: string): Promise<void> {
        patchState(store, { guildId, channelId, pins: [], loading: true });
        try {
          const pins = await service.getPins(guildId, channelId);
          // Ignore a stale response if the user already switched channels.
          if (store.channelId() === channelId) patchState(store, { pins });
        } catch {
          // fail-open: no pins shown
        } finally {
          if (store.channelId() === channelId) patchState(store, { loading: false });
        }
      },

      /** Optimistically pin a message; revert on failure. */
      async pin(
        guildId: string | null,
        channelId: string,
        message: MessageResponse,
      ): Promise<void> {
        if (!isActive(channelId)) {
          await service.pinMessage(guildId, channelId, message.messageId);
          return;
        }
        if (store.pinnedIds().has(message.messageId)) return;
        const previous = store.pins();
        const optimistic: PinnedMessageResponse = {
          message,
          pinnedBy: auth.currentUser()?.id ?? '',
          pinnedAt: message.messageId, // pinnedAt == messageId (the pin's clustering key)
        };
        patchState(store, { pins: [optimistic, ...previous] });
        try {
          await service.pinMessage(guildId, channelId, message.messageId);
        } catch {
          patchState(store, { pins: previous });
        }
      },

      /** Optimistically unpin; revert on failure. */
      async unpin(guildId: string | null, channelId: string, messageId: string): Promise<void> {
        if (!isActive(channelId)) {
          await service.unpinMessage(guildId, channelId, messageId);
          return;
        }
        const previous = store.pins();
        patchState(store, { pins: previous.filter((p) => p.message.messageId !== messageId) });
        try {
          await service.unpinMessage(guildId, channelId, messageId);
        } catch {
          patchState(store, { pins: previous });
        }
      },

      /**
       * SignalR: a message was pinned in a channel. Reload to fetch the full message (the payload
       * only carries ids) — skipped for our own optimistic pin, which is already reflected locally.
       */
      async applyPinned(channelId: string, messageId: string): Promise<void> {
        if (!isActive(channelId) || store.pinnedIds().has(messageId)) return;
        await reload();
      },

      /** SignalR: a message was unpinned — drop it locally (we already hold its id). */
      applyUnpinned(channelId: string, messageId: string): void {
        if (!isActive(channelId)) return;
        patchState(store, { pins: store.pins().filter((p) => p.message.messageId !== messageId) });
      },

      /** A deleted message can no longer be pinned — drop it from the panel. */
      applyMessageDeleted(messageId: string): void {
        if (!store.pinnedIds().has(messageId)) return;
        patchState(store, { pins: store.pins().filter((p) => p.message.messageId !== messageId) });
      },

      clear(): void {
        patchState(store, { guildId: null, channelId: null, pins: [], loading: false });
      },
    };
  }),
  withHooks({
    // Keep the active channel's pins in sync off the gateway stream (all handlers are
    // channel-scoped internally, so events for other channels are ignored).
    onInit(store, gateway = inject(GatewayEvents)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        switch (e.type) {
          case 'MessagePinned':
            void store.applyPinned(e.pin.channelId, e.pin.messageId);
            break;
          case 'MessageUnpinned':
            store.applyUnpinned(e.pin.channelId, e.pin.messageId);
            break;
          case 'MessageDeleted':
            store.applyMessageDeleted(e.messageId);
            break;
        }
      });
    },
  }),
);
