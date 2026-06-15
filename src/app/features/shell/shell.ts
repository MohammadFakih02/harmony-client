import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { SignalRService } from '../../core/services/signalr.service';
import { GuildStore } from '../../core/stores/guild.store';
import { ChannelStore } from '../../core/stores/channel.store';
import { MessageStore } from '../../core/stores/message.store';
import { UnreadStore } from '../../core/stores/unread.store';
import { GuildSidebar } from './guild-sidebar/guild-sidebar';
import { ChannelSidebar } from './channel-sidebar/channel-sidebar';
import { MemberSidebar } from './member-sidebar/member-sidebar';
import { UiIconButton } from '../../shared/ui';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, GuildSidebar, ChannelSidebar, MemberSidebar, UiIconButton],
  templateUrl: './shell.html',
})
export class ShellComponent implements OnInit, OnDestroy {
  protected readonly signalR = inject(SignalRService);
  protected readonly showMembers = signal(true);
  private readonly guildStore = inject(GuildStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly messageStore = inject(MessageStore);
  private readonly unreadStore = inject(UnreadStore);

  private readonly subs = new Subscription();

  async ngOnInit(): Promise<void> {
    // Load guilds and connect in parallel; guild data must be ready before joining groups
    const [client] = await Promise.all([
      this.signalR.connect().catch(() => null),
      this.guildStore.loadGuilds(),
    ]);
    this.unreadStore.loadAll();

    if (!client) return;

    // Wire all server → store events
    this.subs.add(client.messageReceived$.subscribe((msg) => this.messageStore.appendMessage(msg)));
    this.subs.add(client.messageEdited$.subscribe(({ messageId, content, editedAt }) =>
      this.messageStore.editMessage(messageId, content, editedAt)));
    this.subs.add(client.messageDeleted$.subscribe((id) => this.messageStore.deleteMessage(id)));
    this.subs.add(client.messageFailed$.subscribe((p) => this.messageStore.handleFailed(p)));
    this.subs.add(client.unreadCountUpdated$.subscribe((p) => this.unreadStore.setCount(p)));
    this.subs.add(client.channelCreated$.subscribe((ch) => this.channelStore.addChannel(ch)));
    this.subs.add(client.channelUpdated$.subscribe((ch) => this.channelStore.updateChannel(ch)));
    this.subs.add(client.channelDeleted$.subscribe((id) => this.channelStore.removeChannel(id)));

    client.onReconnected(() => this.rejoinGroups());

    // Join all guilds immediately so channel CRUD events arrive for all servers
    await this.joinAllGuilds(client);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.signalR.disconnect();
  }

  private async joinAllGuilds(client = this.signalR.client): Promise<void> {
    if (!client) return;
    for (const guild of this.guildStore.guilds()) {
      await client.joinGuild(guild.id).catch(() => {});
    }
  }

  private async rejoinGroups(): Promise<void> {
    const client = this.signalR.client;
    if (!client) return;

    // Rejoin all guilds (not just the selected one) to keep receiving channel CRUD events
    await this.joinAllGuilds(client);

    // Rejoin the channel the user currently has open
    const channelId = this.channelStore.selectedChannelId();
    if (channelId) await client.joinChannel(channelId).catch(() => {});
  }
}
