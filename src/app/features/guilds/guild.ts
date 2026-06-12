import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { ChannelStore } from '../../core/stores/channel.store';
import { GuildStore } from '../../core/stores/guild.store';
import { SignalRService } from '../../core/services/signalr.service';

@Component({
  selector: 'app-guild',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class Guild implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly guildStore = inject(GuildStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly signalR = inject(SignalRService);

  private guildId = 0;

  async ngOnInit(): Promise<void> {
    this.guildId = Number(this.route.snapshot.params['guildId']);
    this.guildStore.selectGuild(this.guildId);
    await this.channelStore.loadChannels(this.guildId);
    await this.signalR.client?.joinGuild(this.guildId).catch(() => {});
  }

  async ngOnDestroy(): Promise<void> {
    await this.signalR.client?.leaveGuild(this.guildId).catch(() => {});
  }
}
