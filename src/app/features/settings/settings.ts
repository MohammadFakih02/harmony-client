import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountSettings } from './pages/account-settings';
import { AppearanceSettings } from './pages/appearance-settings';
import { AccessibilitySettings } from './pages/accessibility-settings';
import { NotificationSettings } from './pages/notification-settings';
import { PrivacySettings } from './pages/privacy-settings';
import { VoiceSettings } from './pages/voice-settings';
import { TrashSettings } from './pages/trash-settings';

type Tab =
  | 'account'
  | 'privacy'
  | 'notifications'
  | 'appearance'
  | 'accessibility'
  | 'voice'
  | 'trash';

const TABS: readonly Tab[] = [
  'account',
  'privacy',
  'notifications',
  'appearance',
  'accessibility',
  'voice',
  'trash',
];

interface NavGroup {
  title: string;
  items: { id: Tab; label: string; icon: string }[];
}

/**
 * Full-screen Settings overlay (route `/app/settings`). It renders a `fixed inset-0` panel that
 * covers the whole window — even though the route sits inside the shell outlet — with a left nav
 * rail switching content panes by a local `activeTab` signal (no nested routing). Esc / ✕ close
 * back to the previous screen.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountSettings,
    AppearanceSettings,
    AccessibilitySettings,
    NotificationSettings,
    PrivacySettings,
    VoiceSettings,
    TrashSettings,
  ],
  templateUrl: './settings.html',
})
export class Settings {
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  // Deep-linkable pane (`/app/settings?tab=…`). The old `profile` tab merged into My Account,
  // so legacy Edit-Profile deep-links map to `account`.
  protected readonly activeTab = signal<Tab>(
    (() => {
      const raw = inject(ActivatedRoute).snapshot.queryParamMap.get('tab');
      const tab = (raw === 'profile' ? 'account' : raw) as Tab | null;
      return tab && TABS.includes(tab) ? tab : 'account';
    })(),
  );

  protected readonly groups: NavGroup[] = [
    {
      title: 'User Settings',
      items: [
        { id: 'account', label: 'My Account', icon: 'fa-user' },
        { id: 'privacy', label: 'Privacy & Safety', icon: 'fa-shield-halved' },
        { id: 'notifications', label: 'Notifications', icon: 'fa-bell' },
        { id: 'trash', label: 'Trash', icon: 'fa-trash-can' },
      ],
    },
    {
      title: 'App Settings',
      items: [
        { id: 'appearance', label: 'Appearance', icon: 'fa-palette' },
        { id: 'voice', label: 'Voice & Video', icon: 'fa-headset' },
        { id: 'accessibility', label: 'Accessibility', icon: 'fa-universal-access' },
      ],
    },
  ];

  @HostListener('document:keydown.escape')
  close(): void {
    // Entry is always the in-app gear, so back returns to the prior screen; fall back to Friends
    // if there's no in-app history to return to (e.g. a direct deep-link to /app/settings).
    const before = this.router.url;
    this.location.back();
    setTimeout(() => {
      if (this.router.url === before) void this.router.navigate(['/app/friends']);
    }, 0);
  }
}
