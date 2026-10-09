/** Shapes returned by the Apps Script API (see apps-script/Code.gs). Enum values are English data. */

export type UserRole = 'admin' | 'member';
export type UserStatus = 'pending' | 'approved' | 'blocked';

export interface User {
  email: string;
  name: string;
  photoUrl: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  approvedBy: string;
  lastSeenAt: string;
  /** Drive sharing problems after a status change; the Sheet change still stands. */
  warnings?: string[];
}

export type ProjectRole = 'lead' | 'member';

export interface Project {
  id: string;
  name: string;
  description: string;
  folderId: string;
  createdBy: string;
  createdAt: string;
  archived: boolean;
  /** null when an admin sees a project they are not a member of. */
  myRole: ProjectRole | null;
  memberCount: number;
  unread: number;
  lastActivityAt: string;
  warnings?: string[];
}
