import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { ChannelStore } from '../../../core/stores/channel.store';
import { MessageStore } from '../../../core/stores/message.store';
import { MemberStore } from '../../../core/stores/member.store';
import { RoleStore } from '../../../core/stores/role.store';
import { DmStore } from '../../../core/stores/dm.store';
import { FileService } from '../../../core/services/file.service';
import { AuthService } from '../../../core/services/auth.service';
import { SignalRService } from '../../../core/services/signalr.service';
import { AutoGrow } from '../../../shared/directives/auto-grow.directive';
import { MentionAutocomplete, EmojiPicker } from '../../../shared/ui';
import { MentionCandidate } from '../../../core/models/member.models';
import { buildGuildMentionCandidates } from '../../../shared/util/mention-candidates';
import { fuzzyFilter } from '../../../shared/util/fuzzy-match';
import {
  MentionTrigger,
  applyMention,
  detectMentionTrigger,
} from '../../../shared/util/mention-trigger';
import { FileKind, fileIcon, fileKind, isAllowedType } from '../../../shared/util/file-kind';

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // mirrors backend MaxFileSizeBytes
const MAX_FILES = 10; // mirrors backend MessageService.MaxAttachments

let _localIdCounter = 0;

interface StagedFile {
  localId: number;
  name: string;
  kind: FileKind;
  icon: string; // FA class for the non-image tile
  previewUrl: string; // object URL for the image thumbnail ('' for non-images)
  progress: number; // 0-100 (PUT progress)
  status: 'uploading' | 'done' | 'error';
  fileId?: string; // server id, once confirmed
}

@Component({
  selector: 'app-message-input',
  standalone: true,
  imports: [FormsModule, AutoGrow, OverlayModule, MentionAutocomplete, EmojiPicker],
  templateUrl: './message-input.html',
})
export class MessageInput implements OnDestroy {
  protected readonly channelStore = inject(ChannelStore);
  protected readonly messageStore = inject(MessageStore);
  private readonly memberStore = inject(MemberStore);
  private readonly roleStore = inject(RoleStore);
  private readonly dmStore = inject(DmStore);
  private readonly fileService = inject(FileService);
  private readonly auth = inject(AuthService);
  private readonly signalR = inject(SignalRService);

  // Throttle outgoing "started typing" pings — at most one per this window while actively typing.
  private lastTypingAt = 0;

  protected readonly draftInput = viewChild<ElementRef<HTMLTextAreaElement>>('draftInput');

  // Emitted when the user presses ArrowUp on an empty composer — the channel wires this
  // to the message list to start editing their last message (Discord shortcut).
  readonly editLastRequested = output<void>();

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
    return buildGuildMentionCandidates(
      this.memberStore.membersOf(guildId),
      this.roleStore.rolesOf(guildId),
    );
  });

  private readonly dmCandidates = computed<MentionCandidate[]>(() => {
    const channelId = this.messageStore.activeChannelId();
    if (!channelId) return [];
    // Every other participant is mentionable (a single peer for a 1:1, all members for a group).
    return this.dmStore.find(channelId)?.participants ?? [];
  });

  protected readonly mentionCandidates = computed<MentionCandidate[]>(() => {
    const trigger = this.mentionTrigger();
    if (!trigger) return [];
    const pool = this.isDm() ? this.dmCandidates() : this.guildCandidates();
    // Fuzzy match so "owner" finds "seed_owner" and a small typo still resolves.
    return fuzzyFilter(pool, trigger.query, (c) => c.username).slice(0, 10);
  });

  // --- emoji picker ---

  protected readonly emojiOpen = signal(false);

  // Anchored above the composer, aligned to its right edge (where the emoji button sits).
  protected readonly emojiOverlayPositions: ConnectionPositionPair[] = [
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ];

  protected readonly channelName = computed(
    () => this.channelStore.selectedChannel()?.name ?? 'channel',
  );

  // Wall-clock signal so the composer re-enables itself the moment a timeout lapses. A timeout emits
  // MemberUpdated only when set / manually cleared — never on natural expiry — so we re-evaluate
  // against the clock. Gated on an active self-timeout so it idles once the timeout is gone.
  private readonly now = signal(Date.now());
  // 1s so the slowmode countdown ticks smoothly; gated on an active timeout OR cooldown so it idles.
  private readonly ticker = setInterval(() => {
    const timeout = this.myTimeoutUntil();
    const cooldown = this.cooldownUntil();
    if ((timeout != null && timeout > this.now()) || (cooldown != null && cooldown > this.now())) {
      this.now.set(Date.now());
    }
  }, 1000);

  // Slowmode — the active channel's per-user cooldown (0 = off / DM / moderator). Moderators
  // (ManageMessages or ManageChannels) are exempt, matching the server gate.
  private readonly slowmodeSeconds = computed(() => {
    const channel = this.channelStore.selectedChannel();
    if (!channel || this.isDm()) return 0;
    const caps = this.channelStore.currentCapabilities();
    if (caps?.canManageMessages || caps?.canManageChannels) return 0;
    return channel.slowmodeSeconds ?? 0;
  });

  // When the current cooldown ends (unix-ms), or null. Set after each successful send; reset on
  // channel switch (the effect in the constructor).
  private readonly cooldownUntil = signal<number | null>(null);

  /** Remaining whole seconds of the slowmode cooldown, or 0 when not cooling down. */
  protected readonly cooldownRemaining = computed(() => {
    const until = this.cooldownUntil();
    if (until == null) return 0;
    return Math.max(0, Math.ceil((until - this.now()) / 1000));
  });

  // The caller's own member record in the active guild (null in a DM, or before members load).
  // `communicationDisabledUntil` here tracks live via the MemberUpdated gateway event, so a timeout
  // applied/cleared mid-session is reflected without a channel switch.
  private readonly myTimeoutUntil = computed<number | null>(() => {
    const guildId = this.messageStore.activeGuildId();
    const myId = this.auth.currentUser()?.id;
    if (!guildId || !myId) return null;
    return this.memberStore.membersOf(guildId).find((m) => m.userId === myId)
      ?.communicationDisabledUntil ?? null;
  });

  /** Live timeout state — derived from my member record + the wall clock (not the load-time cap). */
  protected readonly timedOut = computed(() => {
    const until = this.myTimeoutUntil();
    return until != null && until > this.now();
  });

  // Whether the caller has permission to send here, independent of any timeout. The capability's
  // `canSend` is timeout-aware at load time, so recover the pure-permission bit as `canSend OR
  // timedOut` (defaults true while caps load). The one imperfect corner — lacking SendMessage *and*
  // being timed out — resolves on the next channel switch, and the server enforces regardless.
  private readonly canSendPermission = computed(() => {
    const caps = this.channelStore.currentCapabilities();
    if (!caps) return true;
    return caps.canSend || caps.timedOut;
  });

  // Whether the caller may send here right now: has permission AND isn't currently timed out (live).
  protected readonly canSendInChannel = computed(
    () => this.canSendPermission() && !this.timedOut(),
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

  // Explains a disabled input — live timeout vs missing permission.
  protected readonly disabledReason = computed(() => {
    if (this.canSendInChannel()) return null;
    return this.timedOut()
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
      this.canSendInChannel() &&
      this.cooldownRemaining() === 0,
  );

  constructor() {
    // Guild mention candidates need the member list cached before the user types '@' —
    // load it as soon as a guild channel is active (same trigger as member-sidebar).
    effect(() => {
      const guildId = this.messageStore.activeGuildId();
      if (guildId) this.memberStore.loadIfNeeded(guildId);
    });

    // Focus the composer when the user starts a reply (Reply clicked in the message list).
    effect(() => {
      if (this.messageStore.replyTarget()) {
        queueMicrotask(() => this.draftInput()?.nativeElement.focus());
      }
    });

    // A slowmode cooldown is per-channel — clear it when switching channels so a new channel
    // isn't blocked by the previous one's countdown.
    effect(() => {
      this.messageStore.activeChannelId();
      untracked(() => this.cooldownUntil.set(null));
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.ticker);
  }

  onDraftInput(value: string): void {
    this.draft.set(value);
    const el = this.draftInput()?.nativeElement;
    const caret = el?.selectionStart ?? value.length;
    const trigger = detectMentionTrigger(value, caret);
    if (trigger) this.closeEmoji(); // don't stack the emoji picker over the mention popup
    this.mentionTrigger.set(trigger);
    this.mentionHighlightedIndex.set(0);
    this.signalTyping(value);
  }

  /** Sends a throttled "started typing" ping (or an immediate "stopped" once the composer empties). */
  private signalTyping(value: string): void {
    const channelId = this.messageStore.activeChannelId();
    if (!channelId) return;
    if (!value.trim()) {
      this.stopTypingSignal();
      return;
    }
    const now = Date.now();
    if (now - this.lastTypingAt > 3000) {
      this.signalR.startTyping(channelId);
      this.lastTypingAt = now;
    }
  }

  private stopTypingSignal(): void {
    const channelId = this.messageStore.activeChannelId();
    this.lastTypingAt = 0;
    if (channelId) this.signalR.stopTyping(channelId);
  }

  selectMention(candidate: MentionCandidate): void {
    const trigger = this.mentionTrigger();
    if (!trigger) return;

    const { text, caret } = applyMention(this.draft(), trigger, candidate.username);
    this.draft.set(text);
    this.closeMentionAutocomplete();

    queueMicrotask(() => {
      const el = this.draftInput()?.nativeElement;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  closeMentionAutocomplete(): void {
    this.mentionTrigger.set(null);
  }

  toggleEmoji(): void {
    const opening = !this.emojiOpen();
    if (opening) this.closeMentionAutocomplete(); // the two overlays share the composer origin
    this.emojiOpen.set(opening);
  }

  closeEmoji(): void {
    this.emojiOpen.set(false);
  }

  /** Inserts the chosen emoji at the caret and keeps the picker open (Discord-style). */
  onEmojiSelect(char: string): void {
    this.insertAtCaret(char);
  }

  /** Splices `text` into the draft at the current caret (or the end), then restores the caret after it. */
  private insertAtCaret(text: string): void {
    const el = this.draftInput()?.nativeElement;
    const value = this.draft();
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    this.draft.set(next);

    queueMicrotask(() => {
      const input = this.draftInput()?.nativeElement;
      if (!input) return;
      const caret = start + text.length;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
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
      !this.canSendInChannel() ||
      // Enter calls send() directly, so the slowmode cooldown must be enforced here too —
      // the disabled send button (canSend) alone doesn't cover the keyboard path.
      this.cooldownRemaining() > 0
    )
      return;

    // Snapshot + clear the reply target before the await so the banner disappears immediately;
    // the id rides along on the optimistic message (and survives a retry).
    const replyToId = this.messageStore.replyTarget()?.messageId ?? null;
    this.messageStore.clearReplyTarget();

    this.sending.set(true);
    this.draft.set('');
    this.stopTypingSignal(); // the message is on its way — clear our typing indicator for others
    this.closeMentionAutocomplete();
    // Clear staging up front; the optimistic message carries the ids and can be retried
    // (the ids are already confirmed, so retryMessage re-sends the same ones).
    const toRevoke = this.staged();
    this.staged.set([]);
    this.attachError.set(null);

    try {
      await this.messageStore.sendMessage(content, fileIds, replyToId);
      // Start the slowmode cooldown optimistically (the server enforces the real gate; this just
      // reflects it in the UI). Moderators/DMs have slowmodeSeconds() === 0, so no cooldown.
      const cooldown = this.slowmodeSeconds();
      if (cooldown > 0) {
        this.now.set(Date.now());
        this.cooldownUntil.set(Date.now() + cooldown * 1000);
      }
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
      if (!isAllowedType(file.type)) {
        this.attachError.set("This file type isn't supported.");
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
    const kind = fileKind(file.type);
    const entry: StagedFile = {
      localId,
      name: file.name,
      kind,
      icon: fileIcon(file.type),
      // Only images get a thumbnail object URL; other kinds show an icon tile.
      previewUrl: kind === 'image' ? URL.createObjectURL(file) : '',
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
      return;
    }

    // ArrowUp on an empty composer jumps to editing your last message.
    if (event.key === 'ArrowUp' && this.draft() === '' && this.staged().length === 0) {
      event.preventDefault();
      this.editLastRequested.emit();
    }
  }
}
