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

export interface Member {
  projectId: string;
  email: string;
  role: ProjectRole;
  addedBy: string;
  addedAt: string;
  name: string;
  photoUrl: string;
  status: UserStatus | '';
  /** Drive sharing problems after add; the Sheet change still stands. */
  warnings?: string[];
}

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high';

export interface Task {
  id: string;
  projectId: string;
  serial: string;
  title: string;
  details: string;
  assigneeEmail: string;
  createdBy: string;
  status: TaskStatus;
  percent: number;
  priority: TaskPriority;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  doneAt: string;
  /** '' = no category. May name a removed category; the app then shows none. */
  categoryId: string;
  /** Old project-wide milestone (C2, no longer shown; the Sheet keeps the column). */
  milestoneId: string;
  /** '' = a normal task; otherwise the task this one follows up (set at creation, never changed). */
  parentTaskId?: string;
}

/** A milestone inside one task. Ticking them drives the task's % on the server. */
export interface Step {
  id: string;
  projectId: string;
  taskId: string;
  name: string;
  position: number;
  reached: boolean;
  reachedAt: string;
  reachedBy: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

/** A project's own list of task categories; any member adds, lead/admin rename or remove. */
export interface Category {
  id: string;
  projectId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

interface Change<T> { from: T; to: T }

/** A task line in chat. The server stores data; the app words it in the reader's language. */
export interface TaskEvent {
  type: 'taskCreated' | 'taskUpdated';
  serial: string;
  title: string;
  assigneeEmail: string;
  status?: TaskStatus;
  dueDate?: string;
  /** taskCreated: the serial of the task this one follows up. */
  parentSerial?: string;
  /** taskUpdated: the task milestone just ticked as reached. */
  reachedStep?: string;
  changes?: {
    status?: Change<TaskStatus>;
    percent?: Change<number>;
    assigneeEmail?: Change<string>;
  };
}

export interface Message {
  id: string;
  projectId: string;
  authorEmail: string;
  kind: 'text' | 'event';
  text: string;
  mentions: string[];
  replyToId: string;
  fileIds: string[];
  taskId: string;
  createdAt: string;
  editedAt: string;
  deleted: boolean;
  event?: TaskEvent | null;
}

export interface DailyUpdate {
  id: string;
  projectId: string;
  authorEmail: string;
  date: string;
  done: string;
  remaining: string;
  blockers: string;
  taskIds: string[];
  fileIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FileItem {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  uploaderEmail: string;
  messageId: string;
  updateId: string;
  createdAt: string;
  url: string;
  /** Drive thumbnail for images; '' for other files. */
  thumbnailUrl: string;
}

export interface SyncResult {
  projectId: string;
  next: string;
  full: boolean;
  hasMoreMessages: boolean;
  lastReadAt: string;
  messages: Message[];
  tasks: Task[];
  updates: DailyUpdate[];
  files: FileItem[];
  categories?: Category[];
  steps?: Step[];
}
