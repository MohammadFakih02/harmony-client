import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
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
  private readonly router = inject(Router);
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

      // Landed on the bare guild route (no channel in the URL) → open the
      // last-visited channel for this guild, or its first text channel.
      // router.url already reflects the full target URL during activation,
      // so this won't hijack a deep-link straight to /channels/:id.
      if (!this.router.url.includes('/channels/')) {
        const target = this.channelStore.resolveDefaultChannel(newGuildId);
        if (target) {
          this.router.navigate(['/app/guilds', newGuildId, 'channels', target], {
            replaceUrl: true,
          });
        }
      }

      // Route through the service so the join survives the connection handshake race on a deep-link
      // refresh (and is re-applied automatically on reconnect) instead of being silently dropped.
      if (prev) void this.signalR.leaveGuild(prev);
      void this.signalR.joinGuild(newGuildId);
    });
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    void this.signalR.leaveGuild(this.guildId);
  }
}
