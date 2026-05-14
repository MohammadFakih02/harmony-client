import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GuildSidebar } from './guild-sidebar/guild-sidebar';
import { ChannelSidebar } from './channel-sidebar/channel-sidebar';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, GuildSidebar, ChannelSidebar],
  templateUrl: './shell.html',
})
export class ShellComponent {}
