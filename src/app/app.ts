import { Component, inject, NgZone } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
})
export class App {
  private theme = inject(ThemeService);

  constructor() {
    // Disable all CSS transitions/animations while the window is resizing
    // (e.g. fullscreen toggle) so the layout snaps instantly instead of animating.
    let resizeTimer: ReturnType<typeof setTimeout>;
    inject(NgZone).runOutsideAngular(() => {
      window.addEventListener('resize', () => {
        document.body.classList.add('resize-animation-stopper');
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(
          () => document.body.classList.remove('resize-animation-stopper'),
          300,
        );
      });
    });
  }
}