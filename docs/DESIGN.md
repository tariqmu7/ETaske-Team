# ETaske Team — design

A lean copy of ETaske built to **replace the project WhatsApp group**: one place per project for
chat, @mentions, tasks per person, daily "what I did / what is left" updates, progress, photos and
files. Same look and Arabic/English + RTL rules as ETaske; **no Firebase**.

Decided with Tariq on 2026-10-09:

| Question | Decision |
|---|---|
| Scope | Lean team copy (not every ETaske screen) |
| Data | Google Sheet (records) + Google Drive (photos/files), behind one Apps Script web app |
| Front end | GitHub Pages, repo `tariqmu7/ETaske-Team` → `https://tariqmu7.github.io/ETaske-Team/` |
| Login | Google account. Anyone may sign in; they **wait for admin approval** |
| Projects | **Several** — each with its own chat, tasks, members and Drive sub-folder |

## 1. Where things live

```
Google Drive  ▸ Work (1mIchNegsG1Fz3rWndvQi6SGelmI3WYsG, owned by tarekmoh123@gmail.com)
              ▸ ETaske Team/                  ← created by setup()
                  ETaske Team — data          ← the Google Sheet (the database)
                  Projects/
                    <project name> (<id>)/    ← one folder per project; every upload goes here
```

- The Apps Script is **bound to the Sheet** and deployed as a web app: *Execute as: me
  (Tariq)*, *Who has access: Anyone*. The script — not the browser — reads and writes the
  Sheet and Drive, so team members never need edit rights on the Sheet.
- `setup()` creates the folder, the Sheet tabs and headers once, and stores the ids in
  Script Properties (`ROOT_FOLDER_ID`, `PROJECTS_FOLDER_ID`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`).
- The GitHub repo holds **code only**. No team data, exports or ids of private files are
  committed. (Pages on a free account needs a public repo — fine, there is no data in it.)

## 2. Sign-in and access

1. The page shows **Sign in with Google** (Google Identity Services). Google gives the page an
   **ID token** (a signed JWT, valid ~1 hour) for the user's e-mail.
2. Every call to the back end carries that token. The script checks it against
   `https://oauth2.googleapis.com/tokeninfo?id_token=…`: `aud` must equal our client id,
   `email_verified` must be true, `exp` in the future. A good result is cached in
   `CacheService` for the token's remaining life, so the check costs one fetch per user per hour.
3. The e-mail is looked up in `users`:
   - not there → a row is added with `status = pending`; the app shows "waiting for approval";
   - `pending` / `blocked` → only `me` is answered;
   - `approved` → normal access. `role = admin` also unlocks the admin screen.
   - E-mails listed in `ADMIN_EMAILS` are approved admins automatically (Tariq).
4. **Project access:** a member sees only projects where they have a `members` row. Admins see
   all. Adding a member also gives that Google account **view** access to the project's Drive
   folder, so photo and file links open for them; removing them takes it away.

OAuth client: reuse the existing web client from the Strategic Tanks move
(`346856045589-…apps.googleusercontent.com`, see `droplet-shutdown` memory). Its authorised
origin `https://tariqmu7.github.io` already covers `/ETaske-Team/`; add `http://localhost:5173`
for local testing if it is not there. Check the consent screen is **In production** so
people outside a test list can sign in.

## 3. The Sheet (one tab per record type)

Every tab has a header row. Dates are ISO strings (UTC) stored as **plain text** (the column is
formatted `@`) so Sheets never reformats them. Ids are `Utilities.getUuid()`.

| Tab | Columns |
|---|---|
| `users` | email · name · photoUrl · role (`admin`/`member`) · status (`pending`/`approved`/`blocked`) · createdAt · approvedBy · lastSeenAt |
| `projects` | id · name · description · folderId · createdBy · createdAt · archived (`TRUE`/blank) |
| `members` | projectId · email · role (`lead`/`member`) · addedBy · addedAt |
| `messages` | id · projectId · authorEmail · text · mentions (comma list of e-mails) · replyToId · fileIds (comma list) · taskId · createdAt · editedAt · deleted |
| `tasks` | id · projectId · serial (`T-001` per project) · title · details · assigneeEmail · createdBy · status (`todo`/`doing`/`blocked`/`done`) · percent (0–100) · priority (`low`/`normal`/`high`) · dueDate (YYYY-MM-DD) · createdAt · updatedAt · doneAt |
| `updates` | id · projectId · authorEmail · date (YYYY-MM-DD) · done · remaining · blockers · taskIds (comma list) · fileIds · createdAt |
| `files` | id (Drive file id) · projectId · name · mimeType · size · uploaderEmail · messageId · updateId · createdAt |
| `reads` | email · projectId · lastReadAt — drives unread counts |
| `meta` | key · value — per-project task serial counters, schema version |

Enum **values** are English data; the app translates them only for display (same rule as
ETaske). Rough capacity: a Sheet holds 10 M cells; at ~10 columns a message that is ~1 M
messages — years of team chat. If it ever gets slow, old messages move to an archive Sheet.

## 4. The API (one web-app URL)

`POST <web app URL>` with a **`text/plain`** body containing JSON
`{ "action": "...", "idToken": "...", ...args }`. Plain text avoids the CORS pre-flight that
Apps Script cannot answer. Every response is `{ ok: true, data }` or `{ ok: false, error, code }`.
All writes run under `LockService.getScriptLock()` so two people saving at once cannot clash.

| Action | Who | What |
|---|---|---|
| `me` | anyone signed in | own user row (creates `pending` on first call) |
| `listUsers` · `setUserStatus` · `setUserRole` | admin | approve / block people, make admins |
| `listProjects` | approved | projects I belong to (all for admin) + unread counts |
| `createProject` · `updateProject` · `archiveProject` | admin | also creates/renames the Drive folder |
| `listMembers` · `addMember` · `removeMember` | admin or project lead | also shares/unshares the Drive folder |
| `sync` | member | everything in one project changed since `since` (messages, tasks, updates, files) + server time to use as the next `since` |
| `postMessage` · `editMessage` · `deleteMessage` | member (edit/delete: author or admin) | mentions are parsed from `@name` by the app and sent as e-mails |
| `createTask` · `updateTask` | member | assign, set status/percent/due; status/percent changes also post a short system line in chat |
| `postUpdate` | member | the daily "what I did / what is left / blockers" |
| `uploadFile` | member | base64 body, ≤ 20 MB after encoding; saved in the project folder; returns the `files` row |
| `markRead` | member | sets `reads.lastReadAt` |

## 5. Live feeling without Firebase

There is no push channel, so the app **polls**: `sync` every **8 s** while the project is
open and the tab is visible, every **60 s** in the background, immediately after the user sends
something. Messages appear for others within ~10 s. Each sync returns only rows changed since
the last cursor, so it stays small.

Quota check (script runs as Tariq, free Gmail account): 15 people × 1 sync / 8 s ≈ 2 calls per
second at peak, each well under a second — inside the 30-simultaneous-executions limit.
`UrlFetch` (token checks) ≈ 15–50 a day thanks to the cache. **No push notifications to the
phone** in this version; unread badges in the app, and (optional, later) an e-mail when someone
@mentions you — Gmail allows ~100 such e-mails a day.

## 6. Photos and files

- Images are resized in the browser to max 1600 px / JPEG 0.8 before upload (a 4 MB phone photo
  becomes ~300 KB), so chats stay fast. Other files go as they are, up to 20 MB.
- In chat, images show through Drive's thumbnail URL
  (`https://drive.google.com/thumbnail?id=<id>&sz=w800`); this works because the viewer is
  signed in to Google and has view access to the project folder. A click opens the Drive file.
- Nothing is ever shared "anyone with the link".

## 7. Screens

1. **Sign in** — Google button; then *waiting for approval* if pending.
2. **Projects** — cards with unread count, my open tasks, last activity. Admin: *New project*.
3. **Project** — tabs:
   - **Chat** — messages, reply, @mention picker, attach photo/file, task cards inline.
   - **Tasks** — grouped by person; status, % bar, due date; "late" first. Turn a message into a task.
   - **Updates** — today's form (done / left / blockers) + the team's feed by date; who has not
     posted today.
   - **Files** — every photo and file in the project, newest first.
   - **People** — members and their roles (admin/lead can add or remove).
4. **Admin** — pending sign-ups to approve, people list, roles.

## 8. Build order (matches the memory TASK QUEUE)

1. Repo skeleton + this design ✅
2. Apps Script part 1: `setup`, token check, users/approval, projects, members, Drive folders
3. Apps Script part 2: messages, tasks, updates, uploads, sync, reads
4. Tariq: create the Sheet, paste the script, run `setup`, deploy the web app, set the two repo
   variables
5. Screens: sign in, waiting, projects, admin approvals
6. Screen: chat (polling, mentions, photos/files)
7. Screens: tasks, updates, files, people
8. Publish on Pages; live test with two Google accounts
9. Short Arabic guide for the team
