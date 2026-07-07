import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Channel } from '../models/channel.models';
import { MessageFailedPayload, MessageResponse, UnreadCountPayload } from '../models/message.models';
import {
  OfflineStatusPayload,
  OnlineStatusPayload,
  StatusChangedPayload,
} from '../models/presence.models';
import { FriendRemovedPayload, FriendUserPayload } from '../models/friend.models';
import { NotificationPayload } from '../models/notification.models';
import {
  KickedPayload,
  MemberJoinedPayload,
  MemberRemovedPayload,
  MemberUpdatedPayload,
} from '../models/member.models';
import { MemberRoleUpdatedPayload, Role, RoleDeletedPayload } from '../models/role.models';

// --- Small per-event shapes (previously private to HarmonyHubClient) ---

export interface MessageEditedEvent {
  messageId: string;
  content: string;
  editedAt: number;
}

export interface MessagePinEvent {
  messageId: string;
  channelId: string;
}

export interface TypingEvent {
  userId: string;
  channelId: string;
}

export interface ProfileUpdatedPayload {
  userId: string;
  avatarKey: string | null;
}

/**
 * Every real-time server→client message as one discriminated union — the unified gateway stream.
 * The hub client coerces each raw SignalR payload (Snowflake ids → strings, longs → numbers) and
 * emits exactly one of these; stores subscribe to {@link GatewayEvents.events$}, filter by `type`,
 * and mutate their own slice. The `type` mirrors the backend IChatClient method name so a single
 * central log traces the whole live pipeline.
 */
export type GatewayEvent =
  | { type: 'MessageReceived'; message: MessageResponse }
  | { type: 'MessageEdited'; edit: MessageEditedEvent }
  | { type: 'MessageDeleted'; messageId: string }
  | { type: 'MessagePinned'; pin: MessagePinEvent }
  | { type: 'MessageUnpinned'; pin: MessagePinEvent }
  | { type: 'MessageFailed'; payload: MessageFailedPayload }
  | { type: 'UnreadCountUpdated'; payload: UnreadCountPayload }
  | { type: 'ChannelCreated'; channel: Channel }
  | { type: 'ChannelUpdated'; channel: Channel }
  | { type: 'ChannelDeleted'; channelId: string }
  | { type: 'TypingStarted'; payload: TypingEvent }
  | { type: 'TypingStopped'; payload: TypingEvent }
  | { type: 'OnlineStatus'; payload: OnlineStatusPayload }
  | { type: 'OfflineStatus'; payload: OfflineStatusPayload }
  | { type: 'StatusChanged'; payload: StatusChangedPayload }
  | { type: 'FriendRequest'; payload: FriendUserPayload }
  | { type: 'FriendAccepted'; payload: FriendUserPayload }
  | { type: 'FriendRemoved'; payload: FriendRemovedPayload }
  | { type: 'NotificationReceived'; payload: NotificationPayload }
  | { type: 'MemberRemoved'; payload: MemberRemovedPayload }
  | { type: 'MemberJoined'; payload: MemberJoinedPayload }
  | { type: 'Kicked'; payload: KickedPayload }
  | { type: 'MemberUpdated'; payload: MemberUpdatedPayload }
  | { type: 'RoleUpserted'; role: Role }
  | { type: 'RoleDeleted'; payload: RoleDeletedPayload }
  | { type: 'MemberRoleUpdated'; payload: MemberRoleUpdatedPayload }
  | { type: 'DmChannelUpdated'; channelId: string }
  | { type: 'ProfileUpdated'; payload: ProfileUpdatedPayload }
  | { type: 'GuildInvitesChanged'; guildId: string };

/** The `type` discriminants — handy for filtering. */
export type GatewayEventType = GatewayEvent['type'];

/**
 * Root-singleton Flux-style dispatcher for the unified gateway stream. Deliberately dependency-free:
 * the hub client pushes into it via {@link emit}, and every store subscribes to {@link events$} from
 * its own `onInit`. Keeping it separate from SignalRService means the stream outlives any individual
 * HubConnection (recreated on disconnect) and stays trivially injectable in unit tests — it never
 * emits there, so store subscriptions are inert.
 */
@Injectable({ providedIn: 'root' })
export class GatewayEvents {
  private readonly _events = new Subject<GatewayEvent>();
  readonly events$ = this._events.asObservable();

  emit(event: GatewayEvent): void {
    // One central place to trace the entire real-time pipeline in dev.
    // eslint-disable-next-line no-console
    console.debug(`[GATEWAY] → ${event.type}`, event);
    this._events.next(event);
  }
}
