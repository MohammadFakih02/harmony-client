import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MessageResponse } from '../../core/models/message.models';
import { ChannelStore } from '../../core/stores/channel.store';
import { MessageStore } from '../../core/stores/message.store';
import { PinStore } from '../../core/stores/pin.store';
import { SignalRService } from '../../core/services/signalr.service';
import { NsfwConsentService } from '../../core/services/nsfw-consent.service';
import { UnreadStore } from '../../core/stores/unread.store';
import { MessageList } from './message-list/message-list';
import { MessageInput } from './message-input/message-input';
import { TypingIndicator } from './typing-indicator/typing-indicator';
import { NsfwGate } from './nsfw-gate/nsfw-gate';
import { VoiceView } from '../voice/voice-view/voice-view';
import { DmCallStage } from '../voice/dm-call-stage/dm-call-stage';

@Component({
  selector: 'app-channel',
  standalone: true,
  imports: [MessageList, MessageInput, TypingIndicator, NsfwGate, VoiceView, DmCallStage],
  host: { class: 'flex flex-col flex-1 min-h-0 overflow-hidden' },
  template: `
    @if (gated()) {
    <app-nsfw-gate
      [channelName]="channelStore.selectedChannel()?.name ?? 'channel'"
      (confirm)="acknowledgeNsfw()"
      (back)="leaveNsfw()"
    />
    } @else if (isVoice()) {
    <app-voice-view />
    } @else {
    @if (dmChannelId(); as dmId) {
    <!-- DM call surface (LiveKit Slice 4) — renders only while this DM has a live call -->
    <app-dm-call-stage [channelId]="dmId" />
    }
    <app-message-list #list class="flex-1 min-h-0" />
    <app-typing-indicator />
    <app-message-input (editLastRequested)="list.editLastOwnMessage()" />
    }
  `,
})
export class Channel implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly channelStore = inject(ChannelStore);
  private readonly messageStore = inject(MessageStore);
  private readonly pinStore = inject(PinStore);
  private readonly unreadStore = inject(UnreadStore);
  private readonly signalR = inject(SignalRService);
  private readonly nsfwConsent = inject(NsfwConsentService);

  /** NSFW channel the viewer hasn't acknowledged yet → show the consent gate instead of messages. */
  protected readonly gated = computed(() => {
    const channel = this.channelStore.selectedChannel();
    return !!channel?.isNsfw && !this.nsfwConsent.has(channel.id);
  });

  /** Voice channels render the voice stage instead of a chat (LiveKit Slice 2). */
  protected readonly isVoice = computed(
    () => this.channelStore.selectedChannel()?.type === 'voice',
  );

  private channelId = '';
  // null = a DM (no owning guild). Guild channels carry their guild id here.
  private guildId: string | null = null;
  /** The open channel when it's a DM (guild-less route) — mounts the embedded call stage. */
  protected readonly dmChannelId = signal<string | null>(null);
  private paramSub?: Subscription;

  ngOnInit(): void {
    this.paramSub = this.route.params.subscribe(async (params) => {
      const newChannelId: string = params['channelId'];
      // The guild id only exists on the guild route's parent; a DM route has none.
      const newGuildId: string | null = this.route.snapshot.parent?.params['guildId'] ?? null;
      if (newChannelId === this.channelId) return;

      const prev = this.channelId;
      this.channelId = newChannelId;
      this.guildId = newGuildId;
      this.dmChannelId.set(newGuildId ? null : newChannelId);

      // Capture the unread count BEFORE mark-read resets it — drives the jump banner.
      const unreadOnOpen = this.unreadStore.counts()[newChannelId] ?? 0;

      this.channelStore.selectChannel(newChannelId);
      if (newGuildId) {
        // Guild-only concerns: last-visited memory + channel capability resolution.
        this.channelStore.rememberChannel(newGuildId, newChannelId);
        this.channelStore.loadCapabilities(newGuildId, newChannelId);
      }

      // Voice channels render the stage, not a chat — skip the text-channel bookkeeping
      // (messages, pins, mark-read, hub text group). Media/roster are VoiceStore's concern.
      if (this.channelStore.selectedChannel()?.type === 'voice') {
        if (prev) void this.signalR.leaveChannel(prev);
        return;
      }

      // Load this channel's pins (drives the 📌 indicator + Pin/Unpin toggle + the pins panel).
      void this.pinStore.load(newGuildId, newChannelId);

      // A parked cross-channel jump (from a search result in another channel) loads a window
      // centred on the target instead of the latest page, and skips the catch-up bookkeeping
      // (mark-read / unread banner / mention highlights) — you're viewing history, not catching up.
      const pendingJump = this.messageStore.consumePendingJump(newChannelId);
      if (pendingJump) {
        await this.messageStore.jumpToMessage(newGuildId, newChannelId, pendingJump.messageId);
      } else {
        await this.messageStore.loadMessages(newGuildId, newChannelId);
        this.messageStore.setUnreadOnOpen(unreadOnOpen);
        // Highlight the unread mentions of me in this view (clears on leave/rejoin).
        this.messageStore.seedMentionHighlights();

        const messages = this.messageStore.messages();
        const newest = [...messages].reverse().find((m: MessageResponse) => !m.tempId);
        if (newest) {
          this.unreadStore.markRead(newGuildId, newChannelId, newest.messageId).catch(() => {});
        }
      }

      // Route through the service so the join is recorded as "desired" and applied once the socket
      // is live — a deep-link refresh activates this before the connection handshake completes, and
      // a blind client?.joinChannel() would be silently dropped (no live messages until you switch).
      if (prev) void this.signalR.leaveChannel(prev);
      void this.signalR.joinChannel(newChannelId);
    });
  }

  /** The viewer confirmed they're of age — remember it and reveal the channel. */
  protected acknowledgeNsfw(): void {
    if (this.channelId) this.nsfwConsent.acknowledge(this.channelId);
  }

  /** Declined the age gate — go back to the guild's default channel (or the guild root). */
  protected leaveNsfw(): void {
    if (this.guildId) {
      const fallback = this.channelStore
        .channelsByGuild()
        [this.guildId]?.find((c) => c.id !== this.channelId && c.type === 'text' && !c.isNsfw);
      void this.router.navigate(
        fallback
          ? ['/app/guilds', this.guildId, 'channels', fallback.id]
          : ['/app/guilds', this.guildId],
      );
    } else {
      void this.router.navigate(['/app/friends']);
    }
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    void this.signalR.leaveChannel(this.channelId);
    this.messageStore.clearMessages();
    this.pinStore.clear();
  }
}
