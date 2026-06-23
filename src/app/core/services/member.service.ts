import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GuildMember } from '../models/member.models';

@Injectable({ providedIn: 'root' })
export class MemberService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  getMembers(guildId: string): Promise<GuildMember[]> {
    return firstValueFrom(this.http.get<GuildMember[]>(`${this.base}/guilds/${guildId}/members`));
  }
}
