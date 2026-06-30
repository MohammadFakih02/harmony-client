import { Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MdNode, parseMarkdown } from '../../../shared/util/markdown';
import { SpoilerDirective } from './spoiler.directive';

/**
 * Renders a message's content with the supported markdown subset (see shared/util/markdown.ts).
 * The node tree is rendered recursively via a self-referencing ng-template + ngTemplateOutlet,
 * using interpolation only — never innerHTML — so it is XSS-safe by construction. @-mentions are
 * folded into the tree as a node type, keeping the existing chip styling. `display: contents`
 * lets inline nodes flow with the surrounding text (e.g. the "(edited)" suffix) while code blocks
 * still lay out as blocks.
 */
@Component({
  selector: 'app-message-content',
  standalone: true,
  imports: [NgTemplateOutlet, SpoilerDirective],
  host: { class: 'contents' },
  templateUrl: './message-content.html',
})
export class MessageContent {
  readonly content = input.required<string>();
  /** Lowercased usernames eligible to render as mention chips (guild members / the DM peer). */
  readonly knownUsernames = input.required<Set<string>>();

  protected readonly nodes = computed<MdNode[]>(() =>
    parseMarkdown(this.content(), this.knownUsernames()),
  );
}
