import { Component, HostListener, inject } from '@angular/core';
import { LightboxService } from './lightbox.service';

/** Full-screen image overlay. Mount once (in the shell); driven by LightboxService. */
@Component({
  selector: 'ui-lightbox',
  standalone: true,
  templateUrl: './lightbox.html',
})
export class Lightbox {
  protected readonly lightbox = inject(LightboxService);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.lightbox.close();
  }
}
