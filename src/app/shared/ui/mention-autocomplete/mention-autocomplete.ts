import { Component, input, output } from '@angular/core';
import { UiAvatar } from '../avatar/ui-avatar';
import { MentionCandidate } from '../../../core/models/member.models';

@Component({
  selector: 'app-mention-autocomplete',
  standalone: true,
  imports: [UiAvatar],
  templateUrl: './mention-autocomplete.html',
})
export class MentionAutocomplete {
  candidates = input<MentionCandidate[]>([]);
  highlightedIndex = input(0);

  select = output<MentionCandidate>();
}
