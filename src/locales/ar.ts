import type en from './en';

/**
 * Arabic (Modern Standard) UI strings. Typed as `Record<keyof typeof en, string>`
 * so the type-check fails the moment a key is added to `en.ts` and not here.
 * Digits stay Latin (the app formats with `-u-nu-latn`).
 */
const ar: Record<keyof typeof en, string> = {
  // ── Language / theme ──
  "Language": "اللغة",
  "English": "English",
  "Arabic": "العربية",
  "Switch to Arabic": "التبديل إلى العربية",
  "Switch to English": "Switch to English",
  "Dark mode": "الوضع الداكن",
  "Light mode": "الوضع الفاتح",

  // ── Error boundary ──
  "Something went wrong": "حدث خطأ",
  "An unexpected error stopped this view from rendering. Reloading usually clears it. If it keeps happening, share the message below.": "أوقف خطأ غير متوقع عرض هذه الصفحة. غالبًا ما تحل إعادة التحميل المشكلة، فإن تكررت فأرسل الرسالة الظاهرة أدناه.",
  "Reload": "إعادة التحميل",

  // ── App shell ──
  "ETaske Team": "ETaske Team",
  "The project team's workspace": "مساحة عمل فريق المشروع",
  "Chat, tasks, daily progress, photos and files for every project, in one place, stored in the team's Google Drive.": "المحادثات والمهام والإنجاز اليومي والصور والملفات لكل مشروع في مكان واحد، محفوظة على Google Drive الخاص بالفريق.",
  "Team chat with @mentions": "محادثة الفريق مع الإشارة بـ @",
  "Tasks for each person": "مهام كل فرد",
  "What I did, what is left": "ما أنجزته وما تبقى",
  "Photos and files on Drive": "الصور والملفات على Drive",
  "Setup not finished": "الإعداد لم يكتمل بعد",
  "Google sign-in and the Drive connection are not switched on yet, so nobody can sign in.": "لم يُفعَّل الدخول بحساب Google ولا الربط مع Drive بعد، لذا يتعذر الدخول حاليًا.",
  "Ready to sign in": "جاهز للدخول",
  "The Google connection is set. Sign-in arrives in the next release.": "اكتمل الربط مع Google، ويُتاح الدخول في الإصدار القادم.",
};

export default ar;
