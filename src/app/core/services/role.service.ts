import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CreateRolePayload, Role, UpdateRolePayload } from '../models/role.models';

@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private roles(guildId: string) {
    return `${this.base}/guilds/${guildId}/roles`;
  }

  getRoles(guildId: string): Promise<Role[]> {
    return firstValueFrom(this.http.get<Role[]>(this.roles(guildId)));
  }

  createRole(guildId: string, body: CreateRolePayload): Promise<Role> {
    return firstValueFrom(this.http.post<Role>(this.roles(guildId), body));
  }

  updateRole(guildId: string, roleId: string, body: UpdateRolePayload): Promise<Role> {
    return firstValueFrom(this.http.patch<Role>(`${this.roles(guildId)}/${roleId}`, body));
  }

  deleteRole(guildId: string, roleId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.roles(guildId)}/${roleId}`));
  }

  reorder(guildId: string, positions: { roleId: string; position: number }[]): Promise<void> {
    return firstValueFrom(
      this.http.patch<void>(`${this.roles(guildId)}/positions`, { positions }),
    );
  }

  assign(guildId: string, roleId: string, userId: string): Promise<void> {
    return firstValueFrom(
      this.http.put<void>(`${this.roles(guildId)}/${roleId}/members/${userId}`, {}),
    );
  }

  unassign(guildId: string, roleId: string, userId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${this.roles(guildId)}/${roleId}/members/${userId}`),
    );
  }
}
