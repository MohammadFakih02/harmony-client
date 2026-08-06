import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';

/**
 * Declaratively attaches a LiveKit video track to the host `<video>` element (and detaches on
 * change/destroy). The element stays template-owned — only the MediaStream binding is imperative,
 * since livekit-client's `Track.attach()` is the supported way to wire a track to an element.
 * Video elements are always `muted`: audio plays through VoiceService's hidden `<audio>` elements,
 * so attaching here can never double the sound.
 */
@Directive({ selector: 'video[appVideoTrack]' })
export class VideoTrackDirective {
  readonly appVideoTrack = input<LocalVideoTrack | RemoteVideoTrack | undefined>();

  constructor() {
    const el = inject(ElementRef<HTMLVideoElement>).nativeElement;
    effect((onCleanup) => {
      const track = this.appVideoTrack();
      if (!track) return;
      track.attach(el);
      onCleanup(() => track.detach(el));
    });
  }
}
