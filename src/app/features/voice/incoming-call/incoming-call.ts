import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CallStore } from '../../../core/stores/call.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { dmLabel, DmParticipant } from '../../../core/models/direct-message.models';
import { UiAvatar } from '../../../shared/ui';

/**
 * The app-wide incoming-call modal (LiveKit Slice 4). Mounted once in the shell so a ring reaches
 * you anywhere; renders only while {@link CallStore} holds an incoming ring. Always-dark like the
 * rest of the call surfaces. Accept joins the room and navigates to the DM (the embedded stage
 * takes over); Decline signals the caller; ✕ ignores locally and lets the ring time out.
 */
@Component({
  selector: 'app-incoming-call',
  standalone: true,
  imports: [UiAvatar],
  templateUrl: './incoming-call.html',
})
export class IncomingCall {
  protected readonly callStore = inject(CallStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly router = inject(Router);

  private readonly dm = computed(() => {
    const ring = this.callStore.incoming();
    return ring ? this.dmStore.find(ring.channelId) : undefined;
  });

  protected readonly caller = computed<DmParticipant | undefined>(() => {
    const ring = this.callStore.incoming();
    return ring
      ? this.dm()?.participants.find((p) => p.userId === ring.callerId)
      : undefined;
  });

  protected readonly callerName = computed(() => {
    const caller = this.caller();
    if (!caller) return 'Someone';
    return this.nicknameStore.nicknameOf(caller.userId) ?? caller.username;
  });

  /** The group's label, shown under the caller for group rings (null for a 1:1). */
  protected readonly groupLabel = computed(() => {
    const dm = this.dm();
    if (!dm?.isGroup) return null;
    return dmLabel(dm, (p) => this.nicknameStore.nicknameOf(p.userId) ?? p.username);
  });

  protected async accept(): Promise<void> {
    const channelId = this.callStore.incoming()?.channelId;
    if (!channelId) return;
    await this.callStore.accept();
    void this.router.navigate(['/app/dm', channelId]);
  }

  protected decline(): void {
    this.callStore.decline();
  }

  protected dismiss(): void {
    this.callStore.dismiss();
  }
}
