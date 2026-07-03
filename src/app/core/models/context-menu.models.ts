/**
 * A single entry in a right-click context menu. Entries are a flat list per menu; an item may carry
 * a one-level `children` submenu (Discord's "Roles ▸" / "Timeout ▸"). `checked` is a reactive getter
 * (evaluated in the template, so it tracks live store signals) used for toggle items; such items set
 * `keepOpen` so the menu stays up while you flip several. Actions may be async.
 */
export interface ContextMenuItem {
  label: string;
  icon?: string; // FontAwesome class, e.g. 'fa-reply'
  danger?: boolean; // red styling for destructive actions (delete / kick / ban)
  disabled?: boolean;
  checked?: () => boolean; // checkbox indicator for toggle items (reactive)
  keepOpen?: boolean; // don't close the menu after the action (checkable submenu items)
  children?: ContextMenuEntry[]; // one-level submenu
  action?: () => void | Promise<void>;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export function isSeparator(e: ContextMenuEntry): e is ContextMenuSeparator {
  return (e as ContextMenuSeparator).separator === true;
}
