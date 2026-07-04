import { Component, computed, input } from "@angular/core";
import { publicFileUrl } from "../../util/public-file-url";

@Component({
  selector: "ui-avatar",
  standalone: true,
  templateUrl: "./ui-avatar.html",
})
export class UiAvatar {
  /** Storage key (avatars/…) or an absolute URL — keys resolve through the public serve endpoint. */
  src = input<string | null>(null);

  protected readonly resolvedSrc = computed(() => publicFileUrl(this.src()));
  alt = input("");
  status = input<"online" | "idle" | "dnd" | "offline" | null>(null);
  size = input<"sm" | "md" | "lg" | "xl">("md");
  ringClass = input<string>("border-surface-2"); // match whatever surface it sits on

  protected sizeClass = computed(
    () =>
      ({
        sm: "w-6 h-6 text-xs",
        md: "w-8 h-8 text-sm",
        lg: "w-10 h-10 text-base",
        xl: "w-12 h-12 text-lg",
      })[this.size()],
  );

  protected readonly statusClasses: Record<string, string> = {
    online: "bg-success",
    idle: "bg-warning",
    dnd: "bg-danger",
    offline: "bg-surface-3",
  };
}
