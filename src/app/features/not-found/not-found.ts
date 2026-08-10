import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HarmonyMark } from '../../shared/ui';

/**
 * Wildcard 404 landing. Reachable logged-in or out, so the CTA points at `/app`
 * (the auth guard forwards guests to login). Shares the auth brand language.
 */
@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, HarmonyMark],
  template: `
    <div class="min-h-dvh zen-mesh-bg flex flex-col items-center justify-center text-center px-6">
      <!-- Wordmark -->
      <div class="flex items-center gap-2.5 mb-10 animate-slide-up">
        <span
          class="flex items-center justify-center w-11 h-11 rounded-2xl bg-surface/70 ring-1 ring-border backdrop-blur-sm shadow-panel"
        >
          <harmony-mark [size]="26" />
        </span>
        <span class="font-display text-lg font-semibold tracking-[-0.02em] text-primary">Harmony</span>
      </div>

      <p class="font-display text-[6rem] leading-none font-bold tracking-[-0.04em] text-primary select-none">
        4<span class="text-accent">0</span>4
      </p>
      <h1 class="font-display mt-5 text-xl font-semibold text-primary">This page wandered off.</h1>
      <p class="mt-2 text-sm text-muted max-w-sm">
        The link may be broken, or the page may have moved. Let's get you back to the conversation.
      </p>

      <a
        routerLink="/app"
        class="mt-8 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover hover:shadow-accent-glow transition-micro active:scale-[0.97]"
      >
        <i class="fas fa-arrow-left text-xs"></i>
        Back to Harmony
      </a>
    </div>
  `,
})
export class NotFound {}
