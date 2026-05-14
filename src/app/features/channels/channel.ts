import { Component } from '@angular/core';

@Component({
  selector: 'app-channel',
  standalone: true,
  template: `
    <div class="flex flex-col items-center justify-center h-full gap-4 animate-fade-in">
      <i class="fas fa-hashtag text-6xl text-faint"></i>
      <h2 class="text-xl font-semibold text-primary">Select a channel</h2>
      <p class="text-sm text-muted">Messages coming in Month 2</p>
    </div>
  `,
})
export class Channel {}
