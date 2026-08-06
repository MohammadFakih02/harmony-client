import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavigationHistoryService } from '../../core/services/navigation-history.service';
import { ViewportService } from '../../core/services/viewport.service';
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
  private readonly router = inject(Router);
  private readonly navHistory = inject(NavigationHistoryService);
  private readonly viewport = inject(ViewportService);
  private readonly hadTabParam = inject(ActivatedRoute).snapshot.queryParamMap.has('tab');

  // Deep-linkable pane (`/app/settings?tab=…`). The old `profile` tab merged into My Account,
  // so legacy Edit-Profile deep-links map to `account`.
  protected readonly activeTab = signal<Tab>(
    (() => {
      const raw = inject(ActivatedRoute).snapshot.queryParamMap.get('tab');
      const tab = (raw === 'profile' ? 'account' : raw) as Tab | null;
      return tab && TABS.includes(tab) ? tab : 'account';
    })(),
  );

  // Mobile stacked flow: the nav list is one screen, the pane another. Only drives `max-md:`
  // classes, so its value is irrelevant on desktop. A tab deep-link starts on the pane.
  protected readonly showPane = signal(!this.viewport.isMobile() || this.hadTabParam);

  protected selectTab(tab: Tab): void {
    this.activeTab.set(tab);
    this.showPane.set(true);
  }

  protected backToNav(): void {
    this.showPane.set(false);
  }

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
    // Return to the exact screen you opened Settings from. Using the recorded previous URL (rather
    // than location.back()) avoids the race where a same-tick history check bounced you to Friends.
    // Falls back to Friends only for a direct deep-link with no prior in-app screen.
    void this.router.navigateByUrl(this.navHistory.previousOutside('/app/settings') ?? '/app/friends');
  }
}
