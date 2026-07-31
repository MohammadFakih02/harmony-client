import {
  Component, ElementRef, computed, signal, viewChild, effect, inject, Injector, output, untracked,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkOverlayOrigin, ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';
import { UiAvatar, MentionAutocomplete, EmojiPicker, ConfirmService } from '../../../shared/ui';
import { MessageStore } from '../../../core/stores/message.store';
import { PinStore } from '../../../core/stores/pin.store';
import { ChannelStore } from '../../../core/stores/channel.store';
import { MemberStore } from '../../../core/stores/member.store';
import { RoleStore } from '../../../core/stores/role.store';
import { DmStore } from '../../../core/stores/dm.store';
import { NicknameStore } from '../../../core/stores/nickname.store';
import { BlockStore } from '../../../core/stores/block.store';
import { FriendStore } from '../../../core/stores/friend.store';
import { MuteStore } from '../../../core/stores/mute.store';
import { LocalSettingsStore } from '../../../core/stores/local-settings.store';
import { Router } from '@angular/router';
import { UnreadStore } from '../../../core/stores/unread.store';
import { memberColor, roleColorHex } from '../../../core/models/role.models';
import { MentionContext, buildMentionSets, mentionContextEquals } from '../../../shared/util/mention-match';
import { AuthService } from '../../../core/services/auth.service';
import { MessageService } from '../../../core/services/message.service';
import { ToastService } from '../../../core/services/toast.service';
import { RoleService } from '../../../core/services/role.service';
import { ProfileModalService } from '../../../core/services/profile-modal.service';
import { ContextMenuService } from '../../../core/services/context-menu.service';
import { buildUserMenu, UserMenuDeps } from '../../shell/user-context-menu';
import { ContextMenuEntry } from '../../../core/models/context-menu.models';
import { MessageResponse } from '../../../core/models/message.models';
import { GuildMember, MentionCandidate } from '../../../core/models/member.models';
import { AutofocusEnd } from '../../../shared/directives/autofocus.directive';
import { delayedSignal } from '../../../shared/util/delayed-signal';
import { buildGuildMentionCandidates } from '../../../shared/util/mention-candidates';
import { fuzzyFilter } from '../../../shared/util/fuzzy-match';
import { getRecents, pushRecent } from '../../../shared/util/emoji-recents';
import { MentionTrigger, applyMention, detectMentionTrigger } from '../../../shared/util/mention-trigger';
import { extractInviteCodes } from '../../../shared/util/invite-links';
import { extractMessageLinks, buildMessageLink, MessageLinkRef } from '../../../shared/util/message-links';
import { dmLabel } from '../../../core/models/direct-message.models';
import { MessageAttachments } from '../message-attachments/message-attachments';
import { MessageContent } from '../message-content/message-content';
import { ForwardModal } from '../forward-modal/forward-modal';
import { InviteEmbed } from '../../guilds/invite-embed/invite-embed';
import { MessageLinkEmbed } from '../message-link-embed/message-link-embed';
import { UserProfilePopout } from '../../shell/user-profile-popout/user-profile-popout';

/** Compact preview of the message a message replies to (found:false → "unavailable" line). */
export interface ReplyPreview {
  found: boolean;
  messageId: string;
  authorName: string;
  content: string;
}

/**
 * A message enriched with everything the template used to resolve per call per change detection
 * (reply preview, invite codes) — precomputed once in the messageGroups computed instead.
 */
export interface RenderedMessage {
  msg: MessageResponse;
  preview: ReplyPreview | null;
  inviteCodes: string[];
  messageLinks: MessageLinkRef[];
}

export interface MessageGroup {
  userId: string;
  username: string;
  avatarKey: string | null;
  firstMessageId: string;
  timestamp: string;
  items: RenderedMessage[];
  // Nickname-aware display name + highest-role colour, resolved once per recompute.
  authorName: string;
  authorColor: string | null;
  // System notices (e.g. member-join) render as standalone centered lines, never as a user burst.
  isSystem: boolean;
  // The author is blocked by the viewer — the burst renders as a collapsed bar until revealed.
  blocked: boolean;
  // Set when this group starts a new calendar day — renders a date separator above it.
  dayLabel: string | null;
}

const SYSTEM_MESSAGE_TYPES = new Set([
  'member_join',
  'system',
  'pin',
  'group_join',
  'group_leave',
  'missed_call',
]);

const GROUP_BREAK_MS = 5 * 60 * 1000;
const LOAD_OLDER_THRESHOLD_PX = 100;
// While anchored (viewing history), scrolling this close to the bottom loads the next newer page.
const LOAD_NEWER_THRESHOLD_PX = 120;
// The off-viewport window trims (deep-history browsing) only run when the edge being cut is at
// least this far outside the viewport (~1.5 screens) — removal that close could shift what's
// visible; beyond it, cutting is imperceptible.
const TRIM_MARGIN_PX = 1200;

function formatMessageTime(sentAt: number): string {
  const d = new Date(sentAt);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yestStart = new Date(dayStart.getTime() - 86_400_000);
  if (d >= dayStart) return `Today at ${time}`;
  if (d >= yestStart) return `Yesterday at ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ` at ${time}`;
}

function formatBannerDate(sentAt: number): string {
  return new Date(sentAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatDayLabel(sentAt: number): string {
  return new Date(sentAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

// The jump banner only appears after a long absence — if the oldest unread is newer than
// this, you were here recently and don't need a "jump to where you left off" prompt.
const UNREAD_BANNER_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [
    UiAvatar,
    FormsModule,
    NgClass,
    AutofocusEnd,
    MessageAttachments,
    MessageContent,
    ForwardModal,
    InviteEmbed,
    MessageLinkEmbed,
    UserProfilePopout,
    OverlayModule,
    MentionAutocomplete,
    EmojiPicker,
  ],
  host: {
    class: 'flex flex-col min-h-0 h-full relative',
    '[class.compact]': 'isCompact()',
  },
  templateUrl: './message-list.html',
})
export class MessageList {
  protected readonly messageStore = inject(MessageStore);
  protected readonly pinStore = inject(PinStore);
  private readonly localSettings = inject(LocalSettingsStore);
  /** Drives the compact host class — denser message rows (Appearance > Message Display). */
  protected readonly isCompact = computed(() => this.localSettings.messageDisplay() === 'compact');
  private readonly channelStore = inject(ChannelStore);
  private readonly memberStore = inject(MemberStore);
  private readonly roleStore = inject(RoleStore);
  private readonly dmStore = inject(DmStore);
  private readonly nicknameStore = inject(NicknameStore);
  private readonly blockStore = inject(BlockStore);
  private readonly muteStore = inject(MuteStore);
  private readonly messageService = inject(MessageService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);
  private readonly unreadStore = inject(UnreadStore);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly confirmService = inject(ConfirmService);
  private readonly userMenuDeps: UserMenuDeps = {
    memberStore: this.memberStore,
    roleStore: this.roleStore,
    roleService: inject(RoleService),
    dmStore: this.dmStore,
    friendStore: inject(FriendStore),
    blockStore: this.blockStore,
    muteStore: this.muteStore,
    profileModal: inject(ProfileModalService),
    toast: this.toast,
    router: inject(Router),
    auth: this.auth,
    confirm: this.confirmService,
  };

  // Mention candidates for chip rendering — consumed by <app-message-content> to decide which
  // @tokens become chips (and to colour role chips). In a guild: member usernames + server
  // nicknames, plus the non-default roles. In a DM: the participant usernames only.
  // Custom equality: member/presence stores re-emit on every routine update; without it the new
  // (identical) object's identity would make EVERY message re-parse its markdown synchronously.
  protected readonly mentionContext = computed<MentionContext>(() => {
    const guildId = this.messageStore.activeGuildId();
    if (guildId) {
      const names: string[] = [];
      for (const m of this.memberStore.membersOf(guildId)) {
        names.push(m.username);
        if (m.nickname) names.push(m.nickname);
      }
      const roles = this.roleStore
        .rolesOf(guildId)
        .filter((r) => !r.isDefault)
        .map((r) => ({ name: r.name, color: roleColorHex(r.color) }));
      return { sets: buildMentionSets(names, roles), guild: true };
    }
    const channelId = this.messageStore.activeChannelId();
    const dm = channelId ? this.dmStore.find(channelId) : undefined;
    const names = dm ? dm.participants.map((p) => p.username) : [];
    return { sets: buildMentionSets(names, []), guild: false };
  }, { equal: mentionContextEquals });

  // Invite codes from any full invite links in the message → inline embed cards. Memoized per
  // message (keyed on content so an edit re-scans) to keep the regex out of the group recompute.
  private readonly inviteCodeCache = new WeakMap<MessageResponse, { content: string; codes: string[] }>();
  private inviteCodesOf(msg: MessageResponse): string[] {
    if (msg.isDeleted) return [];
    const cached = this.inviteCodeCache.get(msg);
    if (cached && cached.content === msg.content) return cached.codes;
    const codes = extractInviteCodes(msg.content);
    // A forwarded message carries the original's text in the server-built snapshot (rendered as a
    // plain quote); surface any invite links there as embeds too, so forwarding an invite still
    // shows the join card rather than a bare link.
    if (msg.forward?.content) {
      for (const code of extractInviteCodes(msg.forward.content)) {
        if (!codes.includes(code)) codes.push(code);
      }
    }
    this.inviteCodeCache.set(msg, { content: msg.content, codes });
    return codes;
  }

  // Links to other Harmony messages → inline "jump to message" cards. Memoized per message (keyed on
  // content) alongside the invite-code scan, to keep the regex out of the group recompute.
  private readonly messageLinkCache = new WeakMap<MessageResponse, { content: string; links: MessageLinkRef[] }>();
  private messageLinksOf(msg: MessageResponse): MessageLinkRef[] {
    if (msg.isDeleted) return [];
    const cached = this.messageLinkCache.get(msg);
    if (cached && cached.content === msg.content) return cached.links;
    const links = extractMessageLinks(msg.content);
    this.messageLinkCache.set(msg, { content: msg.content, links });
    return links;
  }

  // O(1) lookup of a loaded message by id — rebuilt only when the message list changes. Backs the
  // reply-preview resolver so it doesn't scan the whole array per rendered message.
  private readonly messageIndex = computed<Map<string, MessageResponse>>(() => {
    const map = new Map<string, MessageResponse>();
    for (const m of this.messageStore.messages()) map.set(m.messageId, m);
    return map;
  });

  /** Nickname-aware display name for any author (guild server-nickname, else DM friend-nickname). */
  private resolveDisplayName(userId: string, fallbackUsername: string): string {
    const guildId = this.messageStore.activeGuildId();
    if (guildId) {
      const member = this.memberStore.membersOf(guildId).find((m) => m.userId === userId);
      return member?.nickname ?? fallbackUsername;
    }
    return this.nicknameStore.nicknameOf(userId) ?? fallbackUsername;
  }

  /** The optional admin greeting carried by a system (member-join) message; null when blank. */
  /** Short attribution timestamp for the forward-snapshot header ("Today at 3:04 PM", etc.). */
  protected forwardTime(sentAt: number): string {
    return formatMessageTime(sentAt);
  }

  protected systemGreeting(group: MessageGroup): string | null {
    const content = group.items[0]?.msg.content?.trim();
    return content ? content : null;
  }

  // --- author profile popout (opened by clicking a message author's name/avatar) ---
  protected readonly profileGroup = signal<MessageGroup | null>(null);
  protected readonly profileOrigin = signal<CdkOverlayOrigin | null>(null);
  protected readonly profilePositions: ConnectionPositionPair[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  protected openProfile(group: MessageGroup, origin: CdkOverlayOrigin): void {
    this.profileOrigin.set(origin);
    this.profileGroup.set(group);
  }

  protected closeProfile(): void {
    this.profileGroup.set(null);
    this.profileOrigin.set(null);
  }

  // --- right-click context menus (message / author / page) ---

  /** Right-click a message → its actions (reply/copy/pin/forward/edit/delete), gated by capability. */
  protected openMessageMenu(event: MouseEvent, msg: MessageResponse): void {
    const entries: ContextMenuEntry[] = [];
    if (this.canReply(msg)) entries.push({ label: 'Reply', icon: 'fa-reply', action: () => this.replyTo(msg) });
    if (this.canCopy(msg)) entries.push({ label: 'Copy Text', icon: 'fa-copy', action: () => this.copyText(msg) });
    if (this.canReply(msg)) entries.push({ label: 'Copy Message Link', icon: 'fa-link', action: () => this.copyMessageLink(msg) });
    entries.push({ label: 'Copy Message ID', icon: 'fa-hashtag', action: () => this.copyMessageId(msg) });

    const mid: ContextMenuEntry[] = [];
    if (this.canPin(msg)) {
      mid.push({
        label: this.isPinned(msg) ? 'Unpin Message' : 'Pin Message',
        icon: 'fa-thumbtack',
        action: () => this.togglePin(msg),
      });
    }
    if (this.canForward(msg)) mid.push({ label: 'Forward', icon: 'fa-share', action: () => this.openForward(msg) });
    if (mid.length) entries.push({ separator: true }, ...mid);

    const tail: ContextMenuEntry[] = [];
    if (this.canEdit(msg)) tail.push({ label: 'Edit Message', icon: 'fa-pen', action: () => this.startEdit(msg) });
    if (this.canDelete(msg)) {
      tail.push({ label: 'Delete Message', icon: 'fa-trash', danger: true, action: () => this.deleteMsg(msg) });
    }
    if (tail.length) entries.push({ separator: true }, ...tail);

    this.contextMenu.open(event, entries);
  }

  protected copyMessageId(msg: MessageResponse): void {
    void navigator.clipboard?.writeText(msg.messageId).then(
      () => this.toast.info('Copied message ID'),
      () => this.toast.info('Copy failed', 'fa-triangle-exclamation'),
    );
  }

  /** Copies a shareable app link to this message — the writer half of the inline unfurl card. */
  protected copyMessageLink(msg: MessageResponse): void {
    const link = buildMessageLink(location.origin, msg.guildId, msg.channelId, msg.messageId);
    void navigator.clipboard?.writeText(link).then(
      () => this.toast.info('Copied message link'),
      () => this.toast.info('Copy failed', 'fa-triangle-exclamation'),
    );
  }

  /** Right-click a message author → the shared user menu (profile/message/moderation). */
  protected openAuthorMenu(event: MouseEvent, group: MessageGroup): void {
    this.closeProfile();
    const guildId = this.messageStore.activeGuildId();
    const member = guildId
      ? this.memberStore.membersOf(guildId).find((m) => m.userId === group.userId)
      : undefined;
    const caps = guildId ? this.memberStore.capabilitiesOf(guildId) : null;
    this.contextMenu.open(
      event,
      buildUserMenu(this.userMenuDeps, {
        userId: group.userId,
        guildId,
        username: group.username,
        member,
        caps,
      }),
    );
  }

  /** Right-click the empty chat area → a minimal page menu (Mark As Read). */
  protected openPageMenu(event: MouseEvent): void {
    const guildId = this.messageStore.activeGuildId();
    const channelId = this.messageStore.activeChannelId();
    const msgs = this.messageStore.messages();
    const newest = msgs[msgs.length - 1];
    const hasUnread = !!channelId && (this.unreadStore.counts()[channelId] ?? 0) > 0;
    this.contextMenu.open(event, [
      {
        label: 'Mark As Read',
        icon: 'fa-check-double',
        disabled: !hasUnread || !newest || !channelId,
        action: () => {
          if (channelId && newest) void this.unreadStore.markRead(guildId, channelId, newest.messageId);
        },
      },
    ]);
  }

  // Inline-edit state: the messageId being edited and its working draft.
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal('');

  // Fired when an inline edit closes (saved or cancelled) so the channel can hand focus back to the
  // composer — otherwise the next ArrowUp lands on the (unfocused) message list and just scrolls it.
  readonly editFinished = output<void>();

  // @-mention autocomplete inside the inline editor (only one edit box is open at a time,
  // so a single viewChild + trigger signal suffice). Mirrors the composer's behaviour.
  protected readonly editInput = viewChild<ElementRef<HTMLTextAreaElement>>('editInput');
  protected readonly editMentionTrigger = signal<MentionTrigger | null>(null);
  protected readonly editMentionOpen = computed(() => this.editMentionTrigger() !== null);
  protected readonly editMentionHighlightedIndex = signal(0);
  protected readonly editMentionOverlayPositions: ConnectionPositionPair[] = [
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  // Emoji picker inside the inline editor — mirrors the composer, sharing the edit box origin
  // and mutually exclusive with the mention popup (both anchor to #editOrigin).
  protected readonly editEmojiOpen = signal(false);
  protected readonly editEmojiOverlayPositions: ConnectionPositionPair[] = [
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];
  private readonly editMentionPool = computed<MentionCandidate[]>(() => {
    const guildId = this.messageStore.activeGuildId();
    if (guildId) {
      return buildGuildMentionCandidates(
        this.memberStore.membersOf(guildId),
        this.roleStore.rolesOf(guildId),
      );
    }
    const channelId = this.messageStore.activeChannelId();
    return channelId ? (this.dmStore.find(channelId)?.participants ?? []) : [];
  });
  protected readonly editMentionCandidates = computed<MentionCandidate[]>(() => {
    const trigger = this.editMentionTrigger();
    if (!trigger) return [];
    return fuzzyFilter(this.editMentionPool(), trigger.query, (c) => c.username).slice(0, 10);
  });

  protected readonly canManageMessages = computed(
    () => this.channelStore.currentCapabilities()?.canManageMessages ?? false,
  );

  /**
   * Whether the caller may pin/unpin in the open channel. In a guild this is the resolved
   * PinMessages capability; in a DM/group (no guild) any participant may pin — and the viewer
   * is always a participant of a DM they're reading.
   */
  protected readonly canPinMessages = computed(() =>
    this.messageStore.activeGuildId()
      ? (this.channelStore.currentCapabilities()?.canPin ?? false)
      : true,
  );

  // Only surface the initial-load spinner if the fetch takes longer than ~200ms,
  // so fast channel switches don't flash it.
  protected readonly showInitialLoading = delayedSignal(
    computed(() => this.messageStore.isLoading() && this.messageStore.messages().length === 0),
  );

  // Plain scrollable container (no CDK virtual scroll — fixed-size virtualization can't size the
  // variable-height message groups, which caused gaps + jitter). The loaded window is bounded by the
  // MessageStore window cap, so natural-flow rendering stays cheap and scrollHeight is always exact.
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  private prevTailSignature = '';
  private isInitialLoad = true;
  private atBottom = true;
  // While a jump is landing (until this wall-clock ms), scroll-driven content loads are suppressed.
  // Swapping in an anchored window clamps the scroll and the smooth-scroll animation fires a burst of
  // scroll events; without this guard they trigger loadNewer / scroll-to-bottom and instantly yank the
  // view off the jump target — the "jump then jitter straight back" bug, worst for old messages.
  private jumpSettleUntil = 0;

  protected readonly messageGroups = computed<MessageGroup[]>(() => {
    const msgs = this.messageStore.messages();
    const dividerId = this.newDividerId();

    // Author identity resolved once per recompute (O(1) map lookups) instead of per template
    // call per change detection. Tracking member/role/nickname state here is deliberate: a
    // nickname or role-colour change re-renders the list exactly once.
    const guildId = this.messageStore.activeGuildId();
    const membersById = new Map<string, GuildMember>();
    if (guildId) {
      for (const m of this.memberStore.membersOf(guildId)) membersById.set(m.userId, m);
    }
    const roles = guildId ? this.roleStore.rolesOf(guildId) : [];
    const blockedIds = this.blockStore.blockedIds();

    const displayName = (userId: string, fallback: string): string =>
      guildId
        ? (membersById.get(userId)?.nickname ?? fallback)
        : (this.nicknameStore.nicknameOf(userId) ?? fallback);
    const colorOf = (userId: string): string | null => {
      const member = membersById.get(userId);
      return member ? memberColor(member.roleIds, roles) : null;
    };

    const index = this.messageIndex();
    const render = (msg: MessageResponse): RenderedMessage => {
      // Reply preview: found:false when the referenced message isn't loaded (scrolled past /
      // never fetched) or was deleted → a muted "original message unavailable" line.
      let preview: ReplyPreview | null = null;
      if (msg.replyToId && !msg.isDeleted) {
        const ref = index.get(msg.replyToId);
        preview =
          !ref || ref.isDeleted
            ? { found: false, messageId: msg.replyToId, authorName: '', content: '' }
            : {
                found: true,
                messageId: ref.messageId,
                authorName: displayName(ref.userId, ref.username),
                content: ref.content,
              };
      }
      return {
        msg,
        preview,
        inviteCodes: this.inviteCodesOf(msg),
        messageLinks: this.messageLinksOf(msg),
      };
    };

    const groups: MessageGroup[] = [];
    for (const msg of msgs) {
      const isSystem = SYSTEM_MESSAGE_TYPES.has(msg.messageType);
      const last = groups[groups.length - 1];
      const lastMsg = last?.items[last.items.length - 1]?.msg;
      const gap = lastMsg ? msg.sentAt - lastMsg.sentAt : Infinity;
      // A new calendar day always starts a new group (the date separator sits between groups);
      // so does the NEW-messages divider, so it never has to split a burst mid-group.
      const newDay = !lastMsg || !isSameDay(lastMsg.sentAt, msg.sentAt);
      const forcedBreak = newDay || msg.messageId === dividerId;
      // A system notice is always its own group; it never merges with (or accepts) a user burst.
      const sameUser = last && !last.isSystem && last.userId === msg.userId && !msg.failed;

      if (!isSystem && sameUser && gap < GROUP_BREAK_MS && !forcedBreak) {
        last.items.push(render(msg));
      } else {
        groups.push({
          userId: msg.userId ?? '',
          username: msg.username ?? 'Unknown',
          avatarKey: msg.avatarKey ?? null,
          firstMessageId: msg.messageId,
          timestamp: formatMessageTime(msg.sentAt),
          items: [render(msg)],
          authorName: displayName(msg.userId ?? '', msg.username ?? 'Unknown'),
          authorColor: colorOf(msg.userId ?? ''),
          isSystem,
          blocked: !isSystem && blockedIds.has(msg.userId ?? ''),
          dayLabel: newDay ? formatDayLabel(msg.sentAt) : null,
        });
      }
    }

    return groups;
  });

  // -------------------------------------------------------------------------
  // Blocked-author bursts render as a collapsed bar; revealing is per-group and
  // session-only (Discord-style "Show blocked message"). Keyed by firstMessageId
  // (globally unique snowflakes, so no cross-channel collisions).
  // -------------------------------------------------------------------------
  protected readonly revealedBlocked = signal<ReadonlySet<string>>(new Set());

  protected toggleBlockedReveal(groupId: string): void {
    this.revealedBlocked.update((prev) => {
      const next = new Set(prev);
      if (!next.delete(groupId)) next.add(groupId);
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // "NEW" divider — the first unread message, snapshotted once per channel open.
  // A snapshot (not a live computed over unreadOnOpen) so incoming messages
  // don't shift the boundary onto themselves.
  // -------------------------------------------------------------------------
  protected readonly newDividerId = signal<string | null>(null);
  private dividerCapturedFor: string | null = null;
  // Sending a message dismisses the divider for the rest of the visit (Discord behavior) — the
  // flag stops the snapshot effect from re-capturing it; reset on channel change.
  private dividerDismissed = false;

  // -------------------------------------------------------------------------
  // "X new messages" jump banner — driven by the unread count captured when the
  // channel opened (messageStore.unreadOnOpen). The boundary message id isn't on
  // the client, so the first unread is approximated as the last `count` loaded
  // messages (exact enough to jump to where you left off).
  // -------------------------------------------------------------------------
  protected readonly unreadBanner = computed(() => {
    const count = this.messageStore.unreadOnOpen();
    if (count <= 0) return null;
    const msgs = this.messageStore.messages();
    const idx = msgs.length - count;
    const firstUnread = idx >= 0 ? msgs[idx] : msgs[0];
    if (!firstUnread) return null;
    // Suppress the banner unless you've been away from this channel for a while — gated on
    // the age of the oldest unread message (a proxy for how long since you last read here).
    if (Date.now() - firstUnread.sentAt < UNREAD_BANNER_MIN_AGE_MS) return null;
    return {
      count,
      // Only show the date when the boundary message is actually loaded.
      since: idx >= 0 ? formatBannerDate(firstUnread.sentAt) : null,
      firstUnreadId: firstUnread.messageId,
    };
  });

  protected jumpToUnread(): void {
    const banner = this.unreadBanner();
    if (!banner) return;
    this.scrollMessageIntoView(banner.firstUnreadId, 'start');
    this.messageStore.dismissUnreadBanner();
  }

  /**
   * Scrolls the group containing a message into view (natural-flow container → scrollIntoView on the
   * group element). No-op if the message isn't in the loaded window. Returns whether it scrolled.
   */
  private scrollMessageIntoView(messageId: string, block: ScrollLogicalPosition): boolean {
    const root = this.scroller()?.nativeElement;
    if (!root) return false;
    // Prefer the exact message row (data-message); fall back to its group container. Targeting the
    // row lands precisely on a message inside a burst instead of the burst's first message.
    const el =
      root.querySelector<HTMLElement>(`[data-message="${messageId}"]`) ??
      (() => {
        const group = this.messageGroups().find((g) =>
          g.items.some((i) => i.msg.messageId === messageId),
        );
        return group
          ? root.querySelector<HTMLElement>(`[data-group="${group.firstMessageId}"]`)
          : null;
      })();
    if (!el) return false;
    // Cover the smooth-scroll animation: onScroll must not fire content loads while it runs.
    this.jumpSettleUntil = Date.now() + 700;
    el.scrollIntoView({ behavior: 'smooth', block });
    return true;
  }

  protected dismissUnreadBanner(): void {
    // Server-side read state was already updated when the channel opened; this just
    // clears the banner.
    this.messageStore.dismissUnreadBanner();
  }

  // -------------------------------------------------------------------------
  // Edit / delete — own messages always; others' deletable with ManageMessages.
  // The authoritative change arrives via the MessageEdited/MessageDeleted broadcast
  // (shell → store), so these just fire the REST call.
  // -------------------------------------------------------------------------

  protected isMine(msg: MessageResponse): boolean {
    return msg.userId === this.auth.currentUser()?.id;
  }

  protected canEdit(msg: MessageResponse): boolean {
    return this.isMine(msg) && !msg.isDeleted && !msg.pending && !msg.failed;
  }

  protected canDelete(msg: MessageResponse): boolean {
    return (
      (this.isMine(msg) || this.canManageMessages()) &&
      !msg.isDeleted && !msg.pending && !msg.failed
    );
  }

  // Reply/copy are available for any settled message (yours or others') — a confirmed,
  // non-deleted message. Copy additionally needs text content.
  protected canReply(msg: MessageResponse): boolean {
    return !msg.isDeleted && !msg.pending && !msg.failed;
  }

  protected canCopy(msg: MessageResponse): boolean {
    return this.canReply(msg) && msg.content.trim().length > 0;
  }

  // Forward is available for any settled message that carries something to re-send (text or images).
  protected canForward(msg: MessageResponse): boolean {
    return this.canReply(msg) && (msg.content.trim().length > 0 || msg.attachmentIds.length > 0);
  }

  // Pin is available for any settled message when the caller may pin in this channel.
  protected canPin(msg: MessageResponse): boolean {
    return this.canReply(msg) && this.canPinMessages();
  }

  /** Whether a message is currently pinned (drives the toggle label + the persistent marker). */
  protected isPinned(msg: MessageResponse): boolean {
    return this.pinStore.pinnedIds().has(msg.messageId);
  }

  /** Pin or unpin the message (the authoritative change also arrives via the pin broadcast). */
  protected togglePin(msg: MessageResponse): void {
    if (this.isPinned(msg)) {
      void this.pinStore.unpin(msg.guildId, msg.channelId, msg.messageId);
    } else {
      void this.pinStore.pin(msg.guildId, msg.channelId, msg);
    }
  }

  /** The system message's type (e.g. 'pin' vs 'member_join'), for branching the notice render. */
  protected systemMessageType(group: MessageGroup): string {
    return group.items[0]?.msg.messageType ?? 'system';
  }

  /** Bare "14:32" time for the hover gutter on grouped (non-first) messages. */
  protected shortTime(sentAt: number): string {
    return new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** Full absolute date+time — used as the hover tooltip on any timestamp ("Monday, ... at 3:04 PM"). */
  protected fullTime(sentAt: number): string {
    return new Date(sentAt).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' });
  }

  // --- one-click quick reactions (hover toolbar) ---
  // Your most-recent emoji first, topped up from a small default set so the row is always full.
  private static readonly DEFAULT_QUICK = ['👍', '😂', '❤️', '🎉', '😮'];
  protected readonly quickReactions = signal<string[]>(MessageList.computeQuick());

  private static computeQuick(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const char of [...getRecents(), ...MessageList.DEFAULT_QUICK]) {
      if (seen.has(char)) continue;
      seen.add(char);
      out.push(char);
      if (out.length >= 3) break;
    }
    return out;
  }

  /** One-click react from the hover toolbar — toggles the emoji and bumps it up the recents. */
  protected quickReact(msg: MessageResponse, emoji: string): void {
    pushRecent(emoji);
    this.quickReactions.set(MessageList.computeQuick());
    void this.messageStore.toggleReaction(msg, emoji);
  }

  // --- welcome empty-state (no messages yet) ---
  protected readonly emptyTitle = computed(() => {
    if (this.messageStore.activeGuildId()) {
      const name = this.channelStore.selectedChannel()?.name;
      return name ? `Welcome to #${name}!` : 'Welcome!';
    }
    const channelId = this.messageStore.activeChannelId();
    const dm = channelId ? this.dmStore.find(channelId) : undefined;
    return dm
      ? dmLabel(dm, (p) => this.nicknameStore.nicknameOf(p.userId) ?? p.username)
      : 'Welcome!';
  });

  protected readonly emptySubtitle = computed(() => {
    if (this.messageStore.activeGuildId()) {
      const name = this.channelStore.selectedChannel()?.name;
      return name ? `This is the start of the #${name} channel.` : 'This is the start of the channel.';
    }
    return 'This is the beginning of your conversation.';
  });

  /** Whether a message exposes any hover action (drives the hover toolbar's visibility). */
  protected hasActions(msg: MessageResponse): boolean {
    return (
      this.canReact(msg) ||
      this.canReply(msg) ||
      this.canCopy(msg) ||
      this.canForward(msg) ||
      this.canPin(msg) ||
      this.canEdit(msg) ||
      this.canDelete(msg)
    );
  }

  /**
   * Whether the caller may react in the open channel. In a guild this is the resolved AddReactions
   * capability; in a DM/group (no guild) any participant may react — the viewer always is one.
   */
  protected readonly canReactInChannel = computed(() =>
    this.messageStore.activeGuildId()
      ? (this.channelStore.currentCapabilities()?.canReact ?? false)
      : true,
  );

  /** Reactions are available for any settled message when the caller may react in this channel. */
  protected canReact(msg: MessageResponse): boolean {
    return this.canReply(msg) && this.canReactInChannel();
  }

  // --- add-reaction emoji popover (opened from the hover toolbar) ---
  // A single overlay anchored to the clicked message's button (mirrors the profile popout), keyed by
  // messageId so re-clicking the same button toggles it closed.
  protected readonly reactionTarget = signal<MessageResponse | null>(null);
  protected readonly reactionOrigin = signal<CdkOverlayOrigin | null>(null);
  protected readonly reactionPositions: ConnectionPositionPair[] = [
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
  ];

  protected openReactionPicker(msg: MessageResponse, origin: CdkOverlayOrigin): void {
    if (this.reactionTarget()?.messageId === msg.messageId) {
      this.closeReactionPicker();
      return;
    }
    this.reactionOrigin.set(origin);
    this.reactionTarget.set(msg);
  }

  protected closeReactionPicker(): void {
    this.reactionTarget.set(null);
    this.reactionOrigin.set(null);
  }

  /** Picks an emoji from the add-reaction popover → toggle it on, then close. */
  protected onReactionPicked(char: string): void {
    const msg = this.reactionTarget();
    this.closeReactionPicker();
    if (msg) void this.messageStore.toggleReaction(msg, char);
  }

  /** Click an existing reaction pill → toggle the current user's reaction to that emoji. */
  protected toggleReaction(msg: MessageResponse, emoji: string): void {
    void this.messageStore.toggleReaction(msg, emoji);
  }

  // --- forward modal (opened from the hover toolbar) ---
  protected readonly forwardTarget = signal<MessageResponse | null>(null);

  protected openForward(msg: MessageResponse): void {
    this.forwardTarget.set(msg);
  }

  protected closeForward(): void {
    this.forwardTarget.set(null);
  }

  /** Begin replying to a message — shared with the composer via the store. */
  protected replyTo(msg: MessageResponse): void {
    this.messageStore.setReplyTarget({
      messageId: msg.messageId,
      authorName: this.resolveDisplayName(msg.userId, msg.username),
      content: msg.content,
    });
  }

  protected async copyText(msg: MessageResponse): Promise<void> {
    try {
      await navigator.clipboard.writeText(msg.content);
      this.toast.info('Copied to clipboard');
    } catch {
      this.toast.info('Copy failed', 'fa-triangle-exclamation');
    }
  }

  // --- jump-to-referenced highlight (clicking a reply preview) ---
  // Transient: the target message flashes for a moment, then the highlight clears.
  protected readonly jumpHighlightId = signal<string | null>(null);
  private jumpTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Scrolls to a message and briefly flashes it. When jumping into a freshly-loaded window (a search
   * result), the target's DOM may not be committed yet — retry across a few frames before giving up.
   */
  protected jumpToMessage(messageId: string, attempt = 0): void {
    if (this.scrollMessageIntoView(messageId, 'center')) {
      if (this.jumpTimer) clearTimeout(this.jumpTimer);
      this.jumpHighlightId.set(messageId);
      this.jumpTimer = setTimeout(() => this.jumpHighlightId.set(null), 2000);
      return;
    }
    // The target's DOM may not be committed yet when jumping into a freshly-loaded window (an
    // anchored pin/search load, larger lists, images reserving height) — retry across enough frames
    // (~0.3s) that a slow layout settles before we give up. Too few frames was the intermittent
    // "jump-to-pin sometimes does nothing".
    if (attempt < 20) requestAnimationFrame(() => this.jumpToMessage(messageId, attempt + 1));
  }

  /** Returns to the live tail from a historical (anchored) view — the "Jump to Present" pill. */
  protected jumpToPresent(): void {
    void this.messageStore.jumpToPresent();
  }

  /** Highlight class for a message row — unseen-mention bar takes precedence over a transient jump flash. */
  protected highlightClass(msg: MessageResponse): string {
    if (this.messageStore.isMentionHighlight(msg.messageId)) {
      return 'border-l-2 border-warning bg-warning/10 -ml-3 pl-3 rounded-r';
    }
    if (this.jumpHighlightId() === msg.messageId) {
      return 'border-l-2 border-accent bg-accent/10 -ml-3 pl-3 rounded-r';
    }
    return '';
  }

  protected startEdit(msg: MessageResponse): void {
    this.editingId.set(msg.messageId);
    this.editDraft.set(msg.content);
    this.editMentionTrigger.set(null);
    this.editEmojiOpen.set(false);
  }

  /** Starts editing the user's most recent editable message (the composer ArrowUp shortcut). */
  editLastOwnMessage(): void {
    const msgs = this.messageStore.messages();
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (this.canEdit(msgs[i])) {
        this.startEdit(msgs[i]);
        return;
      }
    }
  }

  protected cancelEdit(): void {
    const wasEditing = this.editingId() !== null;
    this.editingId.set(null);
    this.editDraft.set('');
    this.editMentionTrigger.set(null);
    this.editEmojiOpen.set(false);
    // Return focus to the composer so the ArrowUp-to-edit shortcut works again immediately.
    if (wasEditing) this.editFinished.emit();
  }

  protected onEditInput(value: string): void {
    this.editDraft.set(value);
    const el = this.editInput()?.nativeElement;
    const caret = el?.selectionStart ?? value.length;
    const trigger = detectMentionTrigger(value, caret);
    this.editMentionTrigger.set(trigger);
    this.editMentionHighlightedIndex.set(0);
    if (trigger) this.editEmojiOpen.set(false); // don't stack the emoji picker over the mention popup
  }

  protected toggleEditEmoji(): void {
    const opening = !this.editEmojiOpen();
    if (opening) this.editMentionTrigger.set(null); // the two overlays share the edit-box origin
    this.editEmojiOpen.set(opening);
  }

  protected closeEditEmoji(): void {
    this.editEmojiOpen.set(false);
  }

  /** Inserts the chosen emoji into the edit draft at the caret, keeping the picker open. */
  protected onEditEmojiSelect(char: string): void {
    const el = this.editInput()?.nativeElement;
    const value = this.editDraft();
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    this.editDraft.set(value.slice(0, start) + char + value.slice(end));
    queueMicrotask(() => {
      const input = this.editInput()?.nativeElement;
      if (!input) return;
      const caret = start + char.length;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  }

  protected selectEditMention(candidate: MentionCandidate): void {
    const trigger = this.editMentionTrigger();
    if (!trigger) return;
    const { text, caret } = applyMention(this.editDraft(), trigger, candidate.username);
    this.editDraft.set(text);
    this.editMentionTrigger.set(null);
    queueMicrotask(() => {
      const el = this.editInput()?.nativeElement;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  protected async saveEdit(msg: MessageResponse): Promise<void> {
    const content = this.editDraft().trim();
    this.cancelEdit();
    if (!content || content === msg.content) return;
    try {
      await this.messageService.editMessage(msg.guildId, msg.channelId, msg.messageId, content);
    } catch {
      // Don't swallow — a failed edit that shows nothing reads as "can't edit". The authoritative
      // change still arrives via the MessageEdited broadcast on success.
      this.toast.info('Could not edit message', 'fa-triangle-exclamation');
    }
  }

  protected async deleteMsg(msg: MessageResponse): Promise<void> {
    const ok = await this.confirmService.confirm({
      title: 'Delete Message',
      message: "Delete this message? This can't be undone.",
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.messageService.deleteMessage(msg.guildId, msg.channelId, msg.messageId);
    } catch {
      this.toast.info('Could not delete message', 'fa-triangle-exclamation');
    }
  }

  protected onEditKeydown(event: KeyboardEvent, msg: MessageResponse): void {
    // The mention popup intercepts navigation/commit keys while it's open.
    if (this.editMentionOpen()) {
      const candidates = this.editMentionCandidates();
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.editMentionHighlightedIndex.set(
            candidates.length ? (this.editMentionHighlightedIndex() + 1) % candidates.length : 0,
          );
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.editMentionHighlightedIndex.set(
            candidates.length
              ? (this.editMentionHighlightedIndex() - 1 + candidates.length) % candidates.length
              : 0,
          );
          return;
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          if (candidates.length > 0)
            this.selectEditMention(candidates[this.editMentionHighlightedIndex()]);
          else this.editMentionTrigger.set(null);
          return;
        case 'Escape':
          event.preventDefault();
          this.editMentionTrigger.set(null);
          return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.saveEdit(msg);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit();
    }
  }

  constructor() {
    // Snapshot the NEW-divider boundary once per channel open: the first unread message is
    // approximated as the last `unreadOnOpen` loaded messages (same approximation as the jump
    // banner). Captured once so live incoming messages can't move the line onto themselves.
    effect(() => {
      const channelId = this.messageStore.activeChannelId();
      const count = this.messageStore.unreadOnOpen();
      const msgs = this.messageStore.messages();
      if (channelId !== this.dividerCapturedFor) {
        this.dividerCapturedFor = channelId;
        this.dividerDismissed = false;
        this.newDividerId.set(null);
      }
      // Sending your own message means you've caught up — drop the divider instead of leaving it
      // pinned above your reply until you leave and rejoin. Own sends are the only messages that
      // ever appear with `pending`, so a pending tail reliably identifies one.
      if (!this.dividerDismissed && msgs[msgs.length - 1]?.pending) {
        this.dividerDismissed = true;
        this.newDividerId.set(null);
        return;
      }
      if (
        !this.dividerDismissed &&
        untracked(this.newDividerId) === null &&
        count > 0 &&
        msgs.length > 0
      ) {
        const idx = Math.max(0, msgs.length - count);
        this.newDividerId.set(msgs[idx].messageId);
      }
    });

    // Pin to the bottom once the scroll container mounts (channel open) and whenever we return to
    // the live tail. Never while anchored — the jump effect centres on the target instead.
    effect(() => {
      if (this.scroller() && !this.messageStore.anchored()) this.scrollToBottom();
    });

    // React to message list changes
    effect(
      () => {
        const msgs = this.messageStore.messages();
        const last = msgs[msgs.length - 1];

        // Signature changes when a message is added/removed, the tail message's optimistic state
        // flips (pending→failed re-groups it), it's edited, OR its reaction pills change — the last
        // matters because a reaction landing on the bottom message adds a pill row that would push
        // it off-screen unless we re-pin to the bottom.
        const reactionSig = last?.reactions?.map((r) => `${r.emoji}:${r.count}`).join(',') ?? '';
        const signature = `${msgs.length}|${last?.messageId ?? ''}|${last?.pending ?? false}|${last?.failed ?? false}|${last?.editedAt ?? ''}|${reactionSig}`;
        if (signature === this.prevTailSignature) return;
        this.prevTailSignature = signature;

        if (!last) return;

        const myId = this.auth.currentUser()?.id;
        // "Mine" includes optimistic states so a send — or a send that fails —
        // keeps the message (and its Retry button) in view at the bottom.
        const isMine = last.userId === myId || last.pending === true || last.failed === true;

        // Initial load OR my own message OR any change to the tail message while already at the
        // bottom (a new message, an edit that grows it, or a reaction pill row appearing) → pin to
        // bottom. (Loading older history scrolls from the top, must NOT yank; and while anchored to a
        // historical window the jump effect owns scrolling, so never auto-bottom.)
        if (
          (this.isInitialLoad || isMine || this.atBottom) &&
          !this.messageStore.anchored()
        ) {
          this.isInitialLoad = false;
          this.scrollToBottom();
        }
      },
      { injector: this.injector },
    );

    // React to an external jump request (e.g. the pins panel's Jump). The nonce makes repeated
    // jumps to the same message re-fire; the jump is best-effort — it no-ops if the target isn't
    // in the loaded window (no ?around loading yet).
    effect(
      () => {
        const req = this.messageStore.jumpRequest();
        if (!req) return;
        // Guard immediately (before the DOM even re-renders): loading an anchored window replaces the
        // list and clamps the scroll, which fires onScroll before the centre-scroll below runs.
        this.jumpSettleUntil = Date.now() + 1000;
        queueMicrotask(() => this.jumpToMessage(req.messageId));
      },
      { injector: this.injector },
    );
  }

  private scrollToBottom(): void {
    // Natural document flow → scrollHeight is exact. One rAF lets Angular commit the @for
    // render before we read scrollHeight; images reserve space from stored dims (§5.10), so
    // height is stable at this point and no second frame is needed.
    requestAnimationFrame(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  // "Jump to latest" pill — shown when scrolled well away from the live tail (not while anchored,
  // where the Jump to Present pill owns that spot).
  protected readonly showJumpToBottom = signal(false);

  protected jumpToBottom(): void {
    this.showJumpToBottom.set(false);
    this.scrollToBottom();
  }

  /** Degraded-banner Retry: re-run the latest-page load (repaints from cache, refreshes `degraded`). */
  protected retryLoad(): void {
    const channelId = this.messageStore.activeChannelId();
    if (channelId) void this.messageStore.loadMessages(this.messageStore.activeGuildId(), channelId);
  }

  /** Container scroll handler: tracks bottom-anchoring and triggers older-history loads near the top. */
  protected onScroll(): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const wasAtBottom = this.atBottom;
    this.atBottom = fromBottom < 80;
    const anchored = this.messageStore.anchored();
    this.showJumpToBottom.set(!anchored && fromBottom > 300);

    // Auto-hide the "N new messages" banner once the user has scrolled away and back to the
    // bottom (they've seen the unread block). Gated on the false→true transition so the open-time
    // programmatic scroll-to-bottom (which starts atBottom=true) can't insta-dismiss it.
    if (this.atBottom && !wasAtBottom && this.messageStore.unreadOnOpen() > 0) {
      this.messageStore.dismissUnreadBanner();
    }

    // A jump is still landing → suppress every scroll-driven content load below (the loads + the
    // resulting scroll-to-bottom are exactly what yank the view off the freshly-jumped target).
    if (Date.now() < this.jumpSettleUntil) return;

    // Bound the loaded window while pinned to the live bottom (this fires after each programmatic
    // scroll-to-bottom too). Dropping the oldest, off-screen messages keeps the view put — the
    // browser clamps scrollTop to the shrunken content, leaving us at the bottom. Never trim while
    // anchored: the "newest loaded" there is the window's newest, not the channel's true tail.
    if (this.atBottom && !anchored) this.messageStore.trimToWindow();

    if (
      el.scrollTop < LOAD_OLDER_THRESHOLD_PX &&
      this.messageStore.hasMore() &&
      !this.messageStore.isLoading()
    ) {
      void this.loadOlderPreservingPosition();
    }

    // While anchored (viewing history), scrolling near the bottom loads newer messages; reaching
    // the true tail clears anchored mode (back to live) inside the store.
    if (
      anchored &&
      el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_NEWER_THRESHOLD_PX &&
      !this.messageStore.isLoading()
    ) {
      void this.loadNewerPreservingPosition();
    }
  }

  /**
   * Loads older history and preserves the visual position. In a natural-flow container, prepending
   * messages shifts everything down by the added height; we counter it by re-anchoring scrollTop by
   * the exact scrollHeight delta so the message under the viewport stays put.
   *
   * After re-anchoring, the loaded window is trimmed at its NEWEST edge (when it's far below the
   * viewport) so deep-history browsing keeps the DOM bounded instead of growing a page per scroll —
   * removal strictly below the viewport never moves what's visible.
   */
  private async loadOlderPreservingPosition(): Promise<void> {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    await this.messageStore.loadOlder();
    requestAnimationFrame(() => {
      const el2 = this.scroller()?.nativeElement;
      if (!el2) return;
      el2.scrollTop = el2.scrollHeight - prevHeight + prevTop;
      if (el2.scrollHeight - el2.scrollTop - el2.clientHeight > TRIM_MARGIN_PX) {
        this.messageStore.trimToWindowKeepingOldest();
      }
    });
  }

  /**
   * The anchored-mode "load newer" with the mirror trim: appending below the viewport moves
   * nothing, but the over-cap trim then cuts the OLDEST edge (existing trimToWindow), which
   * shifts content up by the removed height — so scrollTop is re-anchored by the exact
   * scrollHeight delta, keeping the message under the viewport put.
   */
  private async loadNewerPreservingPosition(): Promise<void> {
    await this.messageStore.loadNewer();
    const el = this.scroller()?.nativeElement;
    if (!el || el.scrollTop <= TRIM_MARGIN_PX) return;
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    this.messageStore.trimToWindow();
    requestAnimationFrame(() => {
      const el2 = this.scroller()?.nativeElement;
      if (el2) el2.scrollTop = prevTop - (prevHeight - el2.scrollHeight);
    });
  }
}
