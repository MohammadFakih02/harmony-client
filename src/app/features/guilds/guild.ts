import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { ChannelStore } from '../../core/stores/channel.store';
import { GuildStore } from '../../core/stores/guild.store';
import { SignalRService } from '../../core/services/signalr.service';

@Component({
  selector: 'app-guild',
  standalone: true,
  imports: [RouterOutlet],
  host: { class: 'flex flex-col flex-1 min-h-0 overflow-hidden' },
  template: `<router-outlet />`,
})
export class Guild implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly guildStore = inject(GuildStore);
  private readonly channelStore = inject(ChannelStore);
  private readonly signalR = inject(SignalRService);

  private guildId = '';
  private paramSub?: Subscription;

  ngOnInit(): void {
    // Subscribe to param changes so switching between guilds without a page reload
    // triggers a fresh selectGuild + loadChannels (snapshot only fires once).
    this.paramSub = this.route.params.subscribe(async (params) => {
      const newGuildId: string = params['guildId'];
      if (newGuildId === this.guildId) return;

      const prev = this.guildId;
      this.guildId = newGuildId;

      this.guildStore.selectGuild(newGuildId);
      await this.channelStore.loadChannels(newGuildId);

      if (prev) this.signalR.client?.leaveGuild(prev).catch(() => {});
      this.signalR.client?.joinGuild(newGuildId).catch(() => {});
    });
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    this.signalR.client?.leaveGuild(this.guildId).catch(() => {});
  }
}
