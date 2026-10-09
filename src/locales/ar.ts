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
  // ── Navigation and common ──
  "Main navigation": "التنقل الرئيسي",
  "Projects": "المشروعات",
  "Users": "المستخدمون",
  "Sign out": "تسجيل الخروج",
  "Loading…": "جارٍ التحميل…",
  "Refresh": "تحديث",
  "Try again": "أعد المحاولة",
  "Close": "إغلاق",
  "Cancel": "إلغاء",

  // ── Sign in ──
  "Sign in with your Google account to continue.": "ادخل بحساب Google للمتابعة.",
  "Only people the admin approves can see the projects.": "لا يطّلع على المشروعات إلا من يعتمده مدير النظام.",
  "Google sign-in could not load. Check your connection and try again.": "تعذّر تحميل خدمة الدخول بحساب Google؛ تحقّق من الاتصال وأعد المحاولة.",
  "Checking your account…": "جارٍ التحقق من حسابك…",
  "Could not open your account": "تعذّر فتح حسابك",

  // ── Waiting / blocked ──
  "Waiting for approval": "في انتظار الاعتماد",
  "Account blocked": "الحساب موقوف",
  "An admin must approve your account before you can see the projects.": "يلزم أن يعتمد مدير النظام حسابك قبل أن تطّلع على المشروعات.",
  "This account has been blocked. If this is a mistake, contact the admin.": "أُوقف هذا الحساب، فإن كان ذلك عن خطأ فتواصل مع مدير النظام.",
  "Signed in as": "الحساب المستخدَم",
  "This page checks again by itself every 30 seconds.": "تعيد هذه الصفحة التحقق تلقائيًا كل 30 ثانية.",
  "Check now": "تحقّق الآن",

  // ── Projects ──
  "Every project. As an admin you see all of them.": "جميع المشروعات؛ إذ تطّلع عليها كلها بصفتك مديرًا للنظام.",
  "The projects you belong to.": "المشروعات التي تنتمي إليها.",
  "New project": "مشروع جديد",
  "Could not load the projects": "تعذّر تحميل المشروعات",
  "No projects yet": "لا توجد مشروعات بعد",
  "Create the first project, then add the team to it.": "أنشئ المشروع الأول، ثم أضف إليه أعضاء الفريق.",
  "You are not in any project yet. Ask your project lead or the admin to add you.": "لم تُضَف إلى أي مشروع بعد، فاطلب من قائد المشروع أو مدير النظام إضافتك.",
  "Unread messages: {{count}}": "رسائل غير مقروءة: {{count}}",
  "Project lead": "قائد المشروع",
  "Member": "عضو",
  "Not a member": "لست عضوًا",
  "Members: {{count}}": "الأعضاء: {{count}}",
  "Last activity {{when}}": "آخر نشاط {{when}}",
  "Saved, but the Drive folder could not be shared. Open the folder in Drive and share it by hand.": "حُفظ التغيير، بيد أن مشاركة مجلد Drive تعذّرت؛ افتح المجلد على Drive وشاركه يدويًا.",
  "Project name": "اسم المشروع",
  "Description (optional)": "الوصف (اختياري)",
  "A Drive folder is made for the project, and you become its lead.": "يُنشأ للمشروع مجلد على Drive، وتصبح أنت قائده.",
  "Enter a project name.": "اكتب اسم المشروع.",
  "A project with this name already exists.": "يوجد مشروع بهذا الاسم.",
  "Creating…": "جارٍ الإنشاء…",
  "Create project": "إنشاء المشروع",

  // ── Users (admin) ──
  "Approve new sign-ups, block people, and choose who is an admin.": "اعتمد طلبات الانضمام الجديدة، وأوقف من تشاء، وحدِّد من يتولى إدارة النظام.",
  "Could not load the users": "تعذّر تحميل المستخدمين",
  "Nobody is waiting.": "لا توجد طلبات بانتظار الاعتماد.",
  "Signed up {{when}}": "طلب الانضمام {{when}}",
  "Approve": "اعتماد",
  "Block": "إيقاف",
  "Unblock": "إعادة التفعيل",
  "Everyone else": "بقية المستخدمين",
  "Nobody yet.": "لا يوجد أحد بعد.",
  "Last seen {{when}}": "آخر ظهور {{when}}",
  "Pending": "بانتظار الاعتماد",
  "Approved": "معتمد",
  "Blocked": "موقوف",
  "Admin": "مدير النظام",
  "You": "أنت",
  "Make admin": "تعيينه مديرًا",
  "Make member": "إعادته عضوًا",
  "Block {{name}}? They lose access to every project and its Drive folder.": "هل تريد إيقاف {{name}}؟ سيفقد الوصول إلى جميع المشروعات ومجلداتها على Drive.",
  "This admin cannot be blocked or made a member.": "لا يمكن إيقاف هذا المدير أو إعادته عضوًا.",

  // ── Errors ──
  "Could not reach the server. Check your connection and try again.": "تعذّر الوصول إلى الخادم؛ تحقّق من الاتصال وأعد المحاولة.",
  "The server is busy. Please try again in a moment.": "الخادم مشغول حاليًا، فأعد المحاولة بعد لحظات.",
  "Your sign-in has expired. Please sign in again.": "انتهت صلاحية الدخول، فادخل مرة أخرى.",
  "Your account is waiting for admin approval.": "حسابك في انتظار اعتماد مدير النظام.",
  "Your account has been blocked.": "أُوقف حسابك.",
  "You are not allowed to do this.": "لا تملك صلاحية تنفيذ هذا الإجراء.",
  "This item no longer exists.": "لم يعد هذا العنصر موجودًا.",
  "Some of the details are not valid.": "بعض البيانات المُدخلة غير صحيحة.",
  "Something went wrong on the server. Please try again.": "حدث خلل في الخادم، فأعد المحاولة.",
};

export default ar;
