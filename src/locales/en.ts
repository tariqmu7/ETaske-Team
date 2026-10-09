/**
 * English UI strings.
 *
 * The key IS the English source text (i18next `keySeparator: false`). `ar.ts`
 * is typed against this object, so `npm run lint` fails the moment a key is
 * added here and not translated there.
 */
const en = {
  // ── Language / theme ──
  "Language": "Language",
  "English": "English",
  "Arabic": "Arabic",
  "Switch to Arabic": "Switch to Arabic",
  "Switch to English": "Switch to English",
  "Dark mode": "Dark mode",
  "Light mode": "Light mode",

  // ── Error boundary ──
  "Something went wrong": "Something went wrong",
  "An unexpected error stopped this view from rendering. Reloading usually clears it. If it keeps happening, share the message below.": "An unexpected error stopped this view from rendering. Reloading usually clears it. If it keeps happening, share the message below.",
  "Reload": "Reload",

  // ── App shell ──
  "ETaske Team": "ETaske Team",
  "The project team's workspace": "The project team's workspace",
  "Chat, tasks, daily progress, photos and files for every project, in one place, stored in the team's Google Drive.": "Chat, tasks, daily progress, photos and files for every project, in one place, stored in the team's Google Drive.",
  "Team chat with @mentions": "Team chat with @mentions",
  "Tasks for each person": "Tasks for each person",
  "What I did, what is left": "What I did, what is left",
  "Photos and files on Drive": "Photos and files on Drive",
  "Setup not finished": "Setup not finished",
  "Google sign-in and the Drive connection are not switched on yet, so nobody can sign in.": "Google sign-in and the Drive connection are not switched on yet, so nobody can sign in.",
  // ── Navigation and common ──
  "Main navigation": "Main navigation",
  "Projects": "Projects",
  "Users": "Users",
  "Sign out": "Sign out",
  "Loading…": "Loading…",
  "Refresh": "Refresh",
  "Try again": "Try again",
  "Close": "Close",
  "Cancel": "Cancel",

  // ── Sign in ──
  "Sign in with your Google account to continue.": "Sign in with your Google account to continue.",
  "Only people the admin approves can see the projects.": "Only people the admin approves can see the projects.",
  "Google sign-in could not load. Check your connection and try again.": "Google sign-in could not load. Check your connection and try again.",
  "Checking your account…": "Checking your account…",
  "Could not open your account": "Could not open your account",

  // ── Waiting / blocked ──
  "Waiting for approval": "Waiting for approval",
  "Account blocked": "Account blocked",
  "An admin must approve your account before you can see the projects.": "An admin must approve your account before you can see the projects.",
  "This account has been blocked. If this is a mistake, contact the admin.": "This account has been blocked. If this is a mistake, contact the admin.",
  "Signed in as": "Signed in as",
  "This page checks again by itself every 30 seconds.": "This page checks again by itself every 30 seconds.",
  "Check now": "Check now",

  // ── Projects ──
  "Every project. As an admin you see all of them.": "Every project. As an admin you see all of them.",
  "The projects you belong to.": "The projects you belong to.",
  "New project": "New project",
  "Could not load the projects": "Could not load the projects",
  "No projects yet": "No projects yet",
  "Create the first project, then add the team to it.": "Create the first project, then add the team to it.",
  "You are not in any project yet. Ask your project lead or the admin to add you.": "You are not in any project yet. Ask your project lead or the admin to add you.",
  "Unread messages: {{count}}": "Unread messages: {{count}}",
  "Project lead": "Project lead",
  "Member": "Member",
  "Not a member": "Not a member",
  "Members: {{count}}": "Members: {{count}}",
  "Last activity {{when}}": "Last activity {{when}}",
  "Saved, but the Drive folder could not be shared. Open the folder in Drive and share it by hand.": "Saved, but the Drive folder could not be shared. Open the folder in Drive and share it by hand.",
  "Project name": "Project name",
  "Description (optional)": "Description (optional)",
  "A Drive folder is made for the project, and you become its lead.": "A Drive folder is made for the project, and you become its lead.",
  "Enter a project name.": "Enter a project name.",
  "A project with this name already exists.": "A project with this name already exists.",
  "Creating…": "Creating…",
  "Create project": "Create project",

  // ── Users (admin) ──
  "Approve new sign-ups, block people, and choose who is an admin.": "Approve new sign-ups, block people, and choose who is an admin.",
  "Could not load the users": "Could not load the users",
  "Nobody is waiting.": "Nobody is waiting.",
  "Signed up {{when}}": "Signed up {{when}}",
  "Approve": "Approve",
  "Block": "Block",
  "Unblock": "Unblock",
  "Everyone else": "Everyone else",
  "Nobody yet.": "Nobody yet.",
  "Last seen {{when}}": "Last seen {{when}}",
  "Pending": "Pending",
  "Approved": "Approved",
  "Blocked": "Blocked",
  "Admin": "Admin",
  "You": "You",
  "Make admin": "Make admin",
  "Make member": "Make member",
  "Block {{name}}? They lose access to every project and its Drive folder.": "Block {{name}}? They lose access to every project and its Drive folder.",
  "This admin cannot be blocked or made a member.": "This admin cannot be blocked or made a member.",

  // ── Errors ──
  "Could not reach the server. Check your connection and try again.": "Could not reach the server. Check your connection and try again.",
  "The server is busy. Please try again in a moment.": "The server is busy. Please try again in a moment.",
  "Your sign-in has expired. Please sign in again.": "Your sign-in has expired. Please sign in again.",
  "Your account is waiting for admin approval.": "Your account is waiting for admin approval.",
  "Your account has been blocked.": "Your account has been blocked.",
  "You are not allowed to do this.": "You are not allowed to do this.",
  "This item no longer exists.": "This item no longer exists.",
  "Some of the details are not valid.": "Some of the details are not valid.",
  "Something went wrong on the server. Please try again.": "Something went wrong on the server. Please try again.",
};

export default en;
