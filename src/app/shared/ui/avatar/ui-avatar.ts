import { Component, computed, input } from "@angular/core";

@Component({
  selector: "ui-avatar",
  standalone: true,
  templateUrl: "./ui-avatar.html",
})
export class UiAvatar {
  src = input<string | null>(null);
  alt = input("");
  status = input<"online" | "idle" | "dnd" | "offline" | null>(null);
  size = input<"sm" | "md" | "lg" | "xl" | "2xl">("md");
  ringClass = input<string>("border-surface-2"); // match whatever surface it sits on

  protected sizeClass = computed(
    () =>
      ({
        sm: "w-6 h-6 text-xs",
        md: "w-8 h-8 text-sm",
        lg: "w-10 h-10 text-base",
        xl: "w-12 h-12 text-lg",
        "2xl": "w-20 h-20 text-3xl",
      })[this.size()],
  );

  /** Status dot scaled to the avatar — a fixed 10px dot disappears on the 80px profile avatar. */
  protected dotClass = computed(
    () =>
      ({
        sm: "w-2.5 h-2.5 border-2 -bottom-0.5 -right-0.5",
        md: "w-2.5 h-2.5 border-2 -bottom-0.5 -right-0.5",
        lg: "w-3 h-3 border-2 -bottom-0.5 -right-0.5",
        xl: "w-3.5 h-3.5 border-2 -bottom-0.5 -right-0.5",
        "2xl": "w-5 h-5 border-[3px] bottom-0.5 right-0.5",
      })[this.size()],
  );

  protected readonly statusClasses: Record<string, string> = {
    online: "bg-success",
    idle: "bg-warning",
    dnd: "bg-danger",
    offline: "bg-surface-3",
  };
}
