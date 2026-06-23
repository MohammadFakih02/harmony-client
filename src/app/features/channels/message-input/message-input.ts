import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { ChannelStore } from '../../../core/stores/channel.store';
import { MessageStore } from '../../../core/stores/message.store';
import { MemberStore } from '../../../core/stores/member.store';
import { DmStore } from '../../../core/stores/dm.store';
import { FileService } from '../../../core/services/file.service';
import { AutoGrow } from '../../../shared/directives/auto-grow.directive';
import { MentionAutocomplete } from '../../../shared/ui';
import { MentionCandidate } from '../../../core/models/member.models';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // mirrors backend MaxFileSizeBytes
const MAX_FILES = 10; // mirrors backend MessageService.MaxAttachments

let _localIdCounter = 0;

interface StagedFile {
  localId: number;
  name: string;
  previewUrl: string; // object URL for the thumbnail
  progress: number; // 0-100 (PUT progress)
  status: 'uploading' | 'done' | 'error';
  fileId?: string; // server id, once confirmed
}

interface MentionTrigger {
  start: number; // index of '@' in the draft
  query: string; // text typed after '@', lowercased comparison done by callers
}

@Component({
  selector: 'app-message-input',
  standalone: true,
  imports: [FormsModule, AutoGrow, OverlayModule, MentionAutocomplete],
  templateUrl: './message-input.html',
})
export class MessageInput {
  protected readonly channelStore = inject(ChannelStore);
  protected readonly messageStore = inject(MessageStore);
  private readonly memberStore = inject(MemberStore);
  private readonly dmStore = inject(DmStore);
  private readonly fileService = inject(FileService);

  protected readonly draftInput = viewChild<ElementRef<HTMLTextAreaElement>>('draftInput');

  protected readonly draft = signal('');
  protected readonly sending = signal(false);
  protected readonly staged = signal<StagedFile[]>([]);
  protected readonly attachError = signal<string | null>(null);

  // --- @-mention autocomplete ---

  protected readonly mentionTrigger = signal<MentionTrigger | null>(null);
  protected readonly mentionOpen = computed(() => this.mentionTrigger() !== null);
  protected readonly mentionHighlightedIndex = signal(0);

  // Anchored above the composer (Discord-style), aligned to its left edge.
  protected readonly mentionOverlayPositions: ConnectionPositionPair[] = [
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
  ];

  private readonly guildCandidates = computed<MentionCandidate[]>(() => {
    const guildId = this.messageStore.activeGuildId();
    if (!guildId) return [];
    return this.memberStore
      .membersOf(guildId)
      .map((m) => ({ userId: m.userId, username: m.username, avatarKey: m.avatarKey }));
  });

  private readonly dmCandidates = computed<MentionCandidate[]>(() => {
    const channelId = this.messageStore.activeChannelId();
    if (!channelId) return [];
    const dm = this.dmStore.peerOf(channelId);
    return dm ? [{ userId: dm.peerId, username: dm.peerUsername, avatarKey: dm.peerAvatarKey }] : [];
  });

  protected readonly mentionCandidates = computed<MentionCandidate[]>(() => {
    const trigger = this.mentionTrigger();
    if (!trigger) return [];
    const pool = this.isDm() ? this.dmCandidates() : this.guildCandidates();
    const query = trigger.query.toLowerCase();
    const filtered = query
      ? pool.filter((c) => c.username.toLowerCase().startsWith(query))
      : pool;
    return filtered.slice(0, 10);
  });

  protected readonly channelName = computed(
    () => this.channelStore.selectedChannel()?.name ?? 'channel',
  );

  // Whether the caller may send here at all (permission + not timed-out). Defaults to
  // true while capabilities are still loading so normal users aren't briefly blocked;
  // the server enforces regardless.
  protected readonly canSendInChannel = computed(
    () => this.channelStore.currentCapabilities()?.canSend ?? true,
  );

  // A DM (no active guild) has no capability endpoint — attaching is always allowed there.
  protected readonly isDm = computed(
    () => this.messageStore.activeChannelId() != null && this.messageStore.activeGuildId() == null,
  );

  // Attach button is hidden when the caller lacks AttachFiles (defaults to false until
  // capabilities load — the server enforces regardless). Always available in DMs.
  protected readonly canAttach = computed(
    () => this.isDm() || (this.channelStore.currentCapabilities()?.canAttach ?? false),
  );

  // Explains a disabled input — timeout vs missing permission.
  protected readonly disabledReason = computed(() => {
    const caps = this.channelStore.currentCapabilities();
    if (!caps || caps.canSend) return null;
    return caps.timedOut
      ? "You're timed out and can't send messages."
      : 'You do not have permission to send messages in this channel.';
  });

  protected readonly uploading = computed(() =>
    this.staged().some((s) => s.status === 'uploading'),
  );

  private readonly hasConfirmedAttachments = computed(() =>
    this.staged().some((s) => s.status === 'done'),
  );

  protected readonly canSend = computed(
    () =>
      (this.draft().trim().length > 0 || this.hasConfirmedAttachments()) &&
      !this.sending() &&
      !this.uploading() &&
      this.canSendInChannel(),
  );

  constructor() {
    // Guild mention candidates need the member list cached before the user types '@' —
    // load it as soon as a guild channel is active (same trigger as member-sidebar).
    effect(() => {
      const guildId = this.messageStore.activeGuildId();
      if (guildId) this.memberStore.loadIfNeeded(guildId);
    });
  }

  onDraftInput(value: string): void {
    this.draft.set(value);
    const el = this.draftInput()?.nativeElement;
    const caret = el?.selectionStart ?? value.length;
    this.mentionTrigger.set(this.detectMentionTrigger(value, caret));
    this.mentionHighlightedIndex.set(0);
  }

  /** Scans backwards from the caret for an unterminated `@token` (no whitespace inside it). */
  private detectMentionTrigger(value: string, caret: number): MentionTrigger | null {
    let start = caret;
    while (start > 0 && !/\s/.test(value[start - 1])) start--;
    const word = value.slice(start, caret);
    if (!word.startsWith('@')) return null;
    return { start, query: word.slice(1) };
  }

  selectMention(candidate: MentionCandidate): void {
    const trigger = this.mentionTrigger();
    if (!trigger) return;

    const value = this.draft();
    const before = value.slice(0, trigger.start);
    const after = value.slice(trigger.start + 1 + trigger.query.length);
    const insertion = `@${candidate.username} `;
    this.draft.set(before + insertion + after);
    this.closeMentionAutocomplete();

    const caretPos = before.length + insertion.length;
    queueMicrotask(() => {
      const el = this.draftInput()?.nativeElement;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caretPos, caretPos);
    });
  }

  closeMentionAutocomplete(): void {
    this.mentionTrigger.set(null);
  }

  async send(): Promise<void> {
    const content = this.draft().trim();
    const fileIds = this.staged()
      .filter((s) => s.status === 'done' && s.fileId)
      .map((s) => s.fileId!);

    if (
      (!content && fileIds.length === 0) ||
      this.sending() ||
      this.uploading() ||
      !this.canSendInChannel()
    )
      return;

    this.sending.set(true);
    this.draft.set('');
    this.closeMentionAutocomplete();
    // Clear staging up front; the optimistic message carries the ids and can be retried
    // (the ids are already confirmed, so retryMessage re-sends the same ones).
    const toRevoke = this.staged();
    this.staged.set([]);
    this.attachError.set(null);

    try {
      await this.messageStore.sendMessage(content, fileIds);
    } finally {
      this.sending.set(false);
      toRevoke.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    }
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // reset so re-picking the same file fires change again
    this.attachError.set(null);

    for (const file of files) {
      if (this.staged().length >= MAX_FILES) {
        this.attachError.set(`You can attach up to ${MAX_FILES} files.`);
        break;
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        this.attachError.set('Only PNG, JPEG, GIF, or WebP images are allowed.');
        continue;
      }
      if (file.size > MAX_SIZE_BYTES) {
        this.attachError.set('Files must be 50 MB or smaller.');
        continue;
      }
      this.startUpload(file);
    }
  }

  private async startUpload(file: File): Promise<void> {
    const localId = ++_localIdCounter;
    const entry: StagedFile = {
      localId,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
      status: 'uploading',
    };
    this.staged.update((s) => [...s, entry]);

    const guildId = this.messageStore.activeGuildId(); // null for a DM
    const channelId = this.messageStore.activeChannelId();
    if (!channelId) {
      this.patchStaged(localId, { status: 'error' });
      return;
    }

    try {
      const presign = await this.fileService.presign(guildId, channelId, {
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await this.fileService.upload(presign.uploadUrl, file, (pct) =>
        this.patchStaged(localId, { progress: pct }),
      );
      const confirmed = await this.fileService.confirm(guildId, channelId, presign.fileId);
      this.patchStaged(localId, { status: 'done', fileId: confirmed.id, progress: 100 });
    } catch (err) {
      console.error('[attach] upload failed', err);
      this.patchStaged(localId, { status: 'error' });
      this.attachError.set(
        err instanceof Error ? err.message : 'Upload failed. Check your connection and try again.',
      );
    }
  }

  removeStaged(localId: number): void {
    const entry = this.staged().find((s) => s.localId === localId);
    if (entry) URL.revokeObjectURL(entry.previewUrl);
    this.staged.update((s) => s.filter((x) => x.localId !== localId));
  }

  private patchStaged(localId: number, partial: Partial<StagedFile>): void {
    this.staged.update((s) =>
      s.map((x) => (x.localId === localId ? { ...x, ...partial } : x)),
    );
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.mentionOpen()) {
      const candidates = this.mentionCandidates();
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.mentionHighlightedIndex.set(
            candidates.length ? (this.mentionHighlightedIndex() + 1) % candidates.length : 0,
          );
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.mentionHighlightedIndex.set(
            candidates.length
              ? (this.mentionHighlightedIndex() - 1 + candidates.length) % candidates.length
              : 0,
          );
          return;
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          if (candidates.length > 0) this.selectMention(candidates[this.mentionHighlightedIndex()]);
          else this.closeMentionAutocomplete();
          return;
        case 'Escape':
          event.preventDefault();
          this.closeMentionAutocomplete();
          return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }
}
