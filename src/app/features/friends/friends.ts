import { Component } from '@angular/core';

@Component({
  selector: 'app-friends',
  standalone: true,
  template: `
    <div class="flex flex-col items-center justify-center h-full gap-4 animate-fade-in">
      <i class="fas fa-user-group text-6xl text-faint"></i>
      <h2 class="text-xl font-semibold text-primary">Friends</h2>
      <p class="text-sm text-muted">Coming in Month 4</p>
    </div>
  `,
})
export class Friends {}
