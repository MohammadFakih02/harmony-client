import { Component, computed, input } from "@angular/core";
import { UiSpinner } from "../spinner/ui-spinner";

@Component({
  selector: "ui-button",
  standalone: true,
  imports: [UiSpinner],
  templateUrl: "./ui-button.html",
  host: { style: "display: block" },  
})
export class UiButton {
  variant = input<"primary" | "danger" | "ghost" | "icon">("primary");
  size = input<"sm" | "md" | "lg" | "icon">("md");
  block = input<boolean>(false);
  loading = input<boolean>(false);
  disabled = input<boolean>(false);
  type = input<"button" | "submit" | "reset">("button");

  protected isDisabled = computed(() => this.loading() || this.disabled());

  protected classes = computed(() => {
    const base =
      "inline-flex items-center justify-center gap-2 font-semibold transition-micro active:scale-[0.97] " +
      "disabled:opacity-50 disabled:cursor-not-allowed";

    // Tailwind class strings kept literal so the v4 scanner detects them.
    const variants: Record<string, string> = {
      primary:
        "rounded-lg bg-accent hover:bg-accent-hover text-white hover:shadow-accent-glow",
      danger: "rounded-lg bg-danger text-white hover:opacity-90",
      ghost: "rounded-lg text-muted hover:text-primary hover:bg-surface-2",
      icon: "rounded-md text-muted hover:text-primary hover:bg-surface-3",
    };
    const sizes: Record<string, string> = {
      sm: "text-xs px-3 py-1.5",
      md: "text-sm px-4 py-2.5",
      lg: "text-base px-5 py-3",
      icon: "w-8 h-8",
    };

    return `${base} ${variants[this.variant()]} ${sizes[this.size()]} ${this.block() ? "w-full" : ""}`;
  });
}
