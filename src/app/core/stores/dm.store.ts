import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { DirectMessageChannel } from '../models/direct-message.models';
import { GatewayEvents } from '../hub/gateway-events';
import { DirectMessageService } from '../services/direct-message.service';

interface DmState {
  dms: DirectMessageChannel[];
  loading: boolean;
}

export const DmStore = signalStore(
  { providedIn: 'root' },
  withState<DmState>({ dms: [], loading: false }),
  withMethods((store, service = inject(DirectMessageService)) => {
    const upsert = (dm: DirectMessageChannel): void => {
      const without = store.dms().filter((d) => d.channelId !== dm.channelId);
      patchState(store, { dms: [dm, ...without] });
    };

    const refetch = async (): Promise<void> => {
      try {
        patchState(store, { dms: await service.getMyDms() });
      } catch {
        // fail open — keep the current list
      }
    };

    return {
      async load(): Promise<void> {
        patchState(store, { loading: true });
        await refetch();
        patchState(store, { loading: false });
      },

      /** Opens (or reuses) a 1:1 DM and ensures it's in the list. Returns the channel. */
      async open(targetUserId: string): Promise<DirectMessageChannel> {
        const dm = await service.open(targetUserId);
        upsert(dm);
        return dm;
      },

      /** Creates a group DM with the given members (name optional). Returns the channel. */
      async createGroup(name: string | null, userIds: string[]): Promise<DirectMessageChannel> {
        const dm = await service.createGroup(name, userIds);
        upsert(dm);
        return dm;
      },

      /** Adds a user to a group DM, then refreshes the list to pick up the new member. */
      async addParticipant(channelId: string, userId: string): Promise<void> {
        await service.addParticipant(channelId, userId);
        await refetch();
      },

      /** Leaves a group DM (optimistically removes it from the list). */
      async leave(channelId: string): Promise<void> {
        patchState(store, { dms: store.dms().filter((d) => d.channelId !== channelId) });
        await service.leave(channelId).catch(() => {});
      },

      async hide(channelId: string): Promise<void> {
        patchState(store, { dms: store.dms().filter((d) => d.channelId !== channelId) });
        await service.hide(channelId).catch(() => {});
      },

      /** The DM channel for an id, if it's in the loaded list. */
      find(channelId: string): DirectMessageChannel | undefined {
        return store.dms().find((d) => d.channelId === channelId);
      },

      /** Membership changed (group create/add/leave) elsewhere → resync the list. */
      async resync(): Promise<void> {
        await refetch();
      },

      /** A message arrived for a DM not in the list (it had been hidden) → refetch. */
      async ensureVisible(channelId: string): Promise<void> {
        if (store.dms().some((d) => d.channelId === channelId)) return;
        await refetch();
      },

      /** Patches a participant's avatar across all DM/group channels they're in. */
      applyAvatar(userId: string, avatarKey: string | null): void {
        let changed = false;
        const dms = store.dms().map((dm) => {
          if (!dm.participants.some((p) => p.userId === userId && p.avatarKey !== avatarKey)) {
            return dm;
          }
          changed = true;
          return {
            ...dm,
            participants: dm.participants.map((p) =>
              p.userId === userId ? { ...p, avatarKey } : p,
            ),
          };
        });
        if (changed) patchState(store, { dms });
      },
    };
  }),
  withHooks({
    // Own DM-list resync off the gateway stream. The rejoin-the-channel-group side effect of a
    // DmChannelUpdated (needs SignalRService + the active channel) stays in the shell.
    onInit(store, gateway = inject(GatewayEvents)) {
      gateway.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
        switch (e.type) {
          case 'DmChannelUpdated':
            void store.resync();
            break;
          case 'MessageReceived':
            // A DM message can resurface a conversation the recipient had hidden.
            if (e.message.guildId == null) void store.ensureVisible(e.message.channelId);
            break;
          case 'UnreadCountUpdated':
            // A DM unread is the reliable signal a conversation exists for us even when we're not
            // joined to its channel group — surface it if it's new.
            if (e.payload.guildId == null) void store.ensureVisible(e.payload.channelId);
            break;
          case 'ProfileUpdated':
            store.applyAvatar(e.payload.userId, e.payload.avatarKey);
            break;
        }
      });
    },
  }),
);
