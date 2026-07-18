import { AfterViewInit, Component, ElementRef, OnDestroy, output, viewChild } from "@angular/core";
import { environment } from "../../../../environments/environment";

// Google Identity Services has no official npm typings — this ambient `any` is confined to
// this one file, the only place that touches the global.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }): void;
          renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
        };
      };
    };
  }
}

/**
 * Renders the official "Continue with Google" button via Google Identity Services
 * (accounts.google.com/gsi/client, loaded in index.html) and emits the signed ID token it
 * returns. The backend verifies that token — this component never sees or checks anything
 * about its validity.
 *
 * The button is an iframe Google fully controls, so it can't pick up the app's CSS — the
 * closest match is chosen instead: sized to the host container (GIS caps at 400px), themed
 * to the app's light/dark mode, rectangular like the ui-button above it.
 */
@Component({
  selector: "app-google-sign-in-button",
  standalone: true,
  templateUrl: "./google-sign-in-button.html",
})
export class GoogleSignInButton implements AfterViewInit, OnDestroy {
  private readonly container = viewChild.required<ElementRef<HTMLElement>>("container");
  readonly credential = output<string>();

  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retriesLeft = 40; // the GIS script is async/defer — poll ~10s for it before giving up

  ngAfterViewInit(): void {
    this.render();
  }

  ngOnDestroy(): void {
    clearTimeout(this.retryTimer);
  }

  private render(): void {
    if (!window.google) {
      if (this.retriesLeft-- > 0) {
        this.retryTimer = setTimeout(() => this.render(), 250);
      }
      return;
    }

    const host = this.container().nativeElement;

    window.google.accounts.id.initialize({
      client_id: environment.googleClientId,
      callback: (response) => this.credential.emit(response.credential),
    });

    window.google.accounts.id.renderButton(host, {
      theme: document.documentElement.classList.contains("mode-light")
        ? "outline"
        : "filled_black",
      size: "large",
      shape: "rectangular",
      text: "continue_with",
      logo_alignment: "center",
      // GIS localizes the label from the browser/OS locale by default; the app is
      // English-only, so pin the button to match.
      locale: "en",
      // Fill the auth card like the ui-button above; GIS rejects widths over 400.
      width: Math.min(400, host.offsetWidth || 328),
    });
  }
}
