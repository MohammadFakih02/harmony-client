import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Outcome of an enable() attempt, so the settings toggle can react honestly. */
export type PushEnableResult = 'enabled' | 'denied' | 'unsupported' | 'unavailable';

/**
 * Decodes a URL-safe base64 VAPID public key into the raw bytes
 * PushManager.subscribe expects as applicationServerKey.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Web-push subscription lifecycle: registers the hand-rolled /sw.js worker, subscribes
 * against the backend's VAPID public key, and keeps the server's copy of the
 * subscription current. Permission is only ever requested from enable() — i.e. from the
 * Settings toggle click, a real user gesture — never unsolicited. Delivery itself is
 * server-side (the PushOutbox dispatcher); this service just manages the registration.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Push needs a service worker, the Push API, and the Notification API. */
  get isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof window !== 'undefined' &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  get permission(): NotificationPermission | 'unsupported' {
    return this.isSupported ? Notification.permission : 'unsupported';
  }

  /**
   * Full opt-in flow (call from a user gesture): register the worker, request
   * permission, subscribe, and hand the subscription to the backend. 'unavailable'
   * means the server has no VAPID key configured or a step failed — the caller
   * should revert its toggle.
   */
  async enable(): Promise<PushEnableResult> {
    if (!this.isSupported) return 'unsupported';

    let publicKey: string;
    try {
      publicKey = (await this.fetchPublicKey()).publicKey;
    } catch {
      return 'unavailable'; // 404 = VAPID unconfigured on the server
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    try {
      await this.subscribeAndSave(publicKey);
      return 'enabled';
    } catch {
      return 'unavailable';
    }
  }

  /** Unsubscribe this browser and forget the registration server-side. Idempotent. */
  async disable(): Promise<void> {
    if (!this.isSupported) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js');
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await this.deleteSubscription(endpoint);
    } catch {
      // Best-effort — a stale server row is harmless (pushes to it come back Gone
      // and the dispatcher prunes it).
    }
  }

  /**
   * Silent re-sync at startup for users who already granted permission: browser push
   * subscriptions rotate, so re-subscribe and refresh the server's copy. Never prompts.
   */
  async syncIfGranted(): Promise<void> {
    if (!this.isSupported || Notification.permission !== 'granted') return;
    try {
      const { publicKey } = await this.fetchPublicKey();
      await this.subscribeAndSave(publicKey);
    } catch {
      // Fail-open: no push until the user next toggles it — never block startup.
    }
  }

  private async subscribeAndSave(publicKey: string): Promise<void> {
    const registration = await navigator.serviceWorker.register('/sw.js');
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    });
    await this.saveSubscription(subscription.toJSON());
  }

  // ---- HTTP (public for the spec — the browser push APIs above can't run in vitest) ----

  fetchPublicKey(): Promise<{ publicKey: string }> {
    return firstValueFrom(
      this.http.get<{ publicKey: string }>(`${this.base}/notifications/push/public-key`),
    );
  }

  saveSubscription(subscription: PushSubscriptionJSON): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(`${this.base}/notifications/push-subscription`, {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys?.['p256dh'] ?? '',
        authKey: subscription.keys?.['auth'] ?? '',
      }),
    );
  }

  deleteSubscription(endpoint: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.base}/notifications/push-subscription`, {
        params: { endpoint },
      }),
    );
  }
}
