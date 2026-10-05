<div dir="rtl">

# Timestripe Enhancement Extension — MVP PRD & Technical Specification

**المنصة المستهدفة:** Microsoft Edge / Chromium  
**نوع المشروع:** Browser Extension — Manifest V3  
**الحالة:** MVP Scope Locked  
**لغة الواجهة:** English (قرار 2026-10-03 — حساب المستخدم English) مع دعم RTL/LTR كامل للنصوص العربية داخل المهام 
**التخزين في الـMVP:** محلي على الجهاز فقط  
**الهدف:** تحسين Timestripe من غير بناء بديل له، مع الحفاظ على تجربة الاستخدام الأصلية قدر الإمكان.

---

## 1) الفكرة العامة

الإضافة هدفها إنها تجعل Timestripe أسهل وأسرع في أربع نقاط أساسية:

1. **Projects مرنة** بدل الاعتماد على Tags بالشكل الحالي.
2. **ألوان غير محدودة** مرتبطة بالمشاريع، مع إمكانية override لكل Task.
3. **Multi-select وBulk Actions** على Goals/Subgoals حتى لو موجودة في Horizons أو أيام مختلفة.
4. **Duplicate / Templates / Fast Scheduling** لتقليل الشغل اليدوي جدًا، خصوصًا في التخطيط الهرمي:
   - Monthly Goal
   - Weekly Subgoals
   - Daily Subgoals

المطلوب إن الإضافة تحس كأنها Feature Update رسمي لـTimestripe، مش UI منفصل راكب فوق الموقع.

---

# 2) مبادئ المنتج

## 2.1 Timestripe يفضل هو Source of Truth للـGoals
الإضافة لا تبني Task Manager بديل.

بيانات مثل:
- Goal title
- Parent/child relationship
- Horizon
- Date
- Completion
- Notes
- Timestripe IDs

تفضل بيانات أصلية في Timestripe متى أمكن.

## 2.2 بيانات الإضافة نفسها محلية
في الـMVP يتم استخدام Extension Storage لحفظ:
- Projects
- Project colors
- Task → Project mapping إذا لم يمكن تمثيلها رسميًا في Timestripe
- Color overrides
- Templates
- Extension settings
- UI preferences
- Undo snapshots المؤقتة

لا يوجد Backend خاص بالمشروع في الـMVP.

## 2.3 أقل شغل يدوي ممكن
أي Workflow متكرر لازم يكون:
- Bulk
- قابل لإعادة الاستخدام
- قابل للحفظ
- يدعم Defaults ذكية
- لا يتطلب فتح Task وراء Task بلا داعٍ

## 2.4 لا يتم تدمير Selection أو Data بصمت
أي عملية ممكن تضيع:
- Custom selection
- Parent/child structure
- Scheduling
- مجموعة كبيرة من Tasks

يجب أن تحتوي على:
- Confirmation مناسب
- Preview عند الحاجة
- Undo متى كان ذلك عمليًا

---

# 3) Scope الـMVP

الـMVP يشمل:

1. Projects
2. Project Colors
3. Task Color Override
4. Project inheritance للـSubgoals
5. Project indicator داخل Horizons
6. Multi-select
7. Tree-aware selection
8. Partial selection
9. Bulk Change Project
10. Bulk Change Color
11. Bulk Delete
12. Bulk Duplicate
13. Duplicate with options
14. Fast Scheduling by Day
15. Save as Template
16. Apply Template
17. Local Backup Export/Import
18. Dark + Light Theme awareness
19. RTL/LTR support
20. Timestripe-native visual design
21. Per-task Text Direction & Alignment control (Auto/RTL/LTR) — see §36.1

---

# 4) Non-goals في الـMVP

لا يتم تنفيذ الآتي حاليًا:

- سيرفر خاص
- Login منفصل للإضافة
- مزامنة بين أجهزة متعددة
- Mobile app modification
- تغيير Timestripe backend
- Time-of-day scheduler
- Analytics متقدمة
- Calendar integration جديدة
- AI auto-planning
- مزامنة مع موقع gamification خارجي (مؤجلة كتنفيذ — see §41.7 للآثار المعمارية)
- Areas فوق Projects
- Multi-project Task
- إعادة بناء Timestripe UI بالكامل

---

# 5) Projects

## 5.1 تعريف Project

Project هو تصنيف اختياري واحد لكل Goal/Task.

أمثلة:
- Programming
- College
- قرآن
- طلب علم
- Business

لا يوجد Area layer.

## 5.2 قواعد Project

كل Task/Goal:
- يمكن أن يكون بدون Project.
- أو يتبع Project واحد فقط.
- لا يمكن أن يتبع أكثر من Project.

## 5.3 Project Properties

كل Project يحتوي على:

```text
id
name
defaultColor
createdAt
updatedAt
archived
```

اختياريًا مستقبلًا:
```text
icon
description
sortOrder
```

## 5.4 إدارة Projects

تكون متاحة من:

### داخل Timestripe
واجهة صغيرة مدمجة مع الـUI.

### من Extension Popup
واجهة إدارة مستقلة.

أي تعديل يظهر مباشرة في المكانين.

---

# 6) استبدال Tags في تجربة الاستخدام

المطلوب UX-wise:

- واجهة Tags الأصلية لا تكون هي الطريقة الرئيسية للتصنيف.
- Projects تحل محلها في تجربة الاستخدام.
- لا يتم حذف بيانات Tags الأصلية.
- إذا أمكن إخفاؤها بصريًا بشكل آمن، يتم ذلك.
- إذا كان إخفاؤها سيكسر Timestripe أو يتسبب في مشاكل، تظل موجودة لكن Projects تكون أوضح وأقرب للمستخدم.

**مهم:** لا يتم مسح Tags الأصلية تلقائيًا.

---

# 7) Project Inheritance

## 7.1 السلوك الأساسي

إذا كان Parent Goal يتبع Project معين:

مثال:

```text
قرآن - October
└── Week 1
    ├── 30 mins
    ├── 30 mins
    └── 30 mins
```

إذا كان الـParent تابعًا لـProject:
```text
Quran
```

فالـChildren الجديدة ترث:
```text
project = Quran
```

تلقائيًا.

## 7.2 Override

أي Child يمكن تغييره يدويًا إلى:
- Project آخر
- No Project

ويصبح عنده override مستقل.

## 7.3 تغيير Project للـParent

إذا تغير Parent من:
```text
Quran → Study
```

فالـChildren التي ما زالت تستخدم inherited project تتحدث تلقائيًا.

أما Child التي تم تغيير Project لها يدويًا فلا تتغير.

## 7.4 Metadata مطلوبة

من الأفضل أن يميز الـData Model بين:

```text
projectSource = inherited | explicit | none
```

---

# 8) Project Colors

## 8.1 لا يوجد حد 6 ألوان

الإضافة توفر Color Picker كامل.

Project:
```text
defaultColor = arbitrary valid color
```

## 8.2 Task Color

أي Task لها:

```text
effectiveColor
```

ويتم حسابها:

```text
taskColorOverride
→ project.defaultColor
→ Timestripe native/default
```

## 8.3 Color Override

Task تابعة لـProgramming مثلًا، لكن يمكن جعل لونها مختلفًا يدويًا.

Metadata:

```text
colorSource = project | override | native
```

## 8.4 تغيير Project color

إذا تغير لون Project:
- Tasks التي تستخدم project color تتحدث تلقائيًا.
- Tasks التي لديها override لا تتأثر.

---

# 9) طرق عرض الألوان

يتم دعم طريقتين:

## 9.1 Full Color Mode
خلفية الـTask بالكامل بلون الـProject/Task.

## 9.2 Color Strip Mode
خلفية Timestripe الأصلية تبقى كما هي، ويظهر:
- Strip جانبي ملون
- Project name صغير

## 9.3 Setting
يقدر المستخدم يبدل بين الوضعين في أي وقت.

الـTask color override لا يتغير عند تبديل طريقة العرض.

---

# 10) Project Indicator داخل Horizons

دي Requirement أساسية.

حتى لو الـTask Daily Subgoal داخل Weekly Goal داخل Monthly Goal:

```text
Monthly Quran Goal
└── Weekly Goal
    └── Daily 30 mins
```

عند ظهور Daily Task داخل Day Horizon يجب أن يظهر فورًا:
- Project name
- Project color

بدون الحاجة لفتح Parent.

مثال بصري:

```text
30 mins
Quran
```

أو Strip بلون Quran.

لا نعرض breadcrumb طويل في الـMVP.

لا نعرض:
```text
Quran > October > Week 1
```

لأن المستخدم غالبًا فاتح Day/Week/Month Horizons جنب بعض.

---

# 11) Multi-select

## 11.1 الهدف

يقدر المستخدم يحدد أكثر من Goal/Subgoal ثم ينفذ عملية جماعية.

التحديد يمكن أن يعبر:
- نفس اليوم
- أيام مختلفة
- أسابيع مختلفة
- Horizons مختلفة
- Goals وSubgoals
- Parents مختلفة

## 11.2 Checkbox الـMulti-select منفصل عن Completion

علامة تحديد العناصر للعملية الجماعية لا يجوز أن تكون نفس checkbox إكمال المهمة.

يجب أن يكون واضح بصريًا أن هناك:
```text
Selection Mode
```

مستقل.

---

# 12) Selection Manager

بمجرد بدء Multi-select يظهر شريط/Panel موحد.

يعرض مثلًا:

```text
7 selected
3 parents
2 horizons
```

ويعرض العمليات المتاحة.

يفضل أن يظل التحديد محفوظًا أثناء التنقل بين Views إلى أن:
- ينفذ المستخدم عملية
- يلغي selection
- يغلق Selection Mode

---

# 13) Goal Tree Selection

## 13.1 Selecting Parent Goal

عند تحديد Parent Goal:
- يتم تحديد كل Descendants تلقائيًا.
- يشمل كل الأعماق.

مثال:

```text
A
├── B
│   ├── C
│   └── D
└── E
```

تحديد A يحدد:
```text
A, B, C, D, E
```

## 13.2 Manual exclusion

بعد تحديد Parent يمكن إلغاء تحديد Child معينة.

مثال:
```text
A selected
B selected
C excluded
D selected
E selected
```

يصبح A في:
```text
Partial Selection State
```

## 13.3 Partial state

Parent يظهر بحالة:
- unchecked
- checked
- partial/indeterminate

## 13.4 الضغط على Parent وهي Partial

لا يتم تدمير Custom Selection فورًا.

يظهر Confirmation صغير:

```text
17 of 20 selected.

[Select all 20]
[Clear this group]
[Cancel]
```

## 13.5 Undo

بعد تغيير جماعي في selection:
- يظهر Undo لفترة قصيرة.
- يعيد الـexact previous selection snapshot.

قاعدة المنتج:

> Never silently destroy a custom selection state.

---

# 14) Selection Normalization

مهم جدًا لتجنب تنفيذ العملية مرتين.

إذا كان المستخدم اختار:
- Parent
- Child من نفس الشجرة

والـParent بالفعل يشمل Child، يجب على Execution Engine أن يعرف أن Child ليست عنصرًا مستقلًا إضافيًا.

يجب تحويل Selection داخليًا إلى:
```text
unique goal IDs
```

مع awareness للعلاقات.

---

# 15) Bulk Action Availability

الإضافة لا تعرض نفس العمليات دائمًا بشكل أعمى.

تقيم Selection أولًا.

أمثلة:

### Selection من Tasks يومية فقط
يمكن:
- Change project
- Change color
- Reschedule day
- Duplicate
- Delete
- Save as template

### Goals من Horizons مختلفة
يمكن:
- Change project
- Change color
- Duplicate
- Delete
- Save as template

أما Scheduling operations تعتمد على نوع العناصر.

### Parent + Children
يجب منع double-processing.

---

# 16) Bulk Change Project

على Selection كامل:

خيارات:
- Assign Project X
- Remove Project

عند تغيير Parent:
- inherited descendants تتبع rules الوراثة.
- explicit descendants لا تتغير إلا إذا المستخدم اختار:
  ```text
  Apply to selected descendants explicitly
  ```

في الـMVP يفضل أن يكون default آمن:
- Apply only to selected items
- مع respect للـinheritance rules

---

# 17) Bulk Change Color

خيارات:

```text
Use project color
Custom color
Reset override
```

يمكن تطبيقها على Selection.

---

# 18) Bulk Delete

عملية Destructive.

يجب أن تعرض:

```text
You are about to delete 14 goals.
3 selected goals contain descendants.
```

ويفضل Preview مختصر.

إذا كان Timestripe deletion semantics غير واضحة للـchildren يجب اكتشافها في Technical Spike قبل التنفيذ.

لا يتم افتراض cascading behavior.

---

# 19) Duplicate — أساس الـMVP

عملية Duplicate الحالية في Timestripe غير كافية للاستخدام المطلوب.

الإضافة يجب أن تقدم مستويين:

## 19.1 Quick Duplicate
عملية سريعة بأقل clicks.

## 19.2 Duplicate with Options
تفتح Dialog صغيرة Timestripe-native.

---

# 20) خيارات Duplicate

أول اختيار أساسي:

```text
( ) Duplicate main goal only
( ) Duplicate with subgoals
```

إذا اختار:
```text
Duplicate with subgoals
```

يتم الحفاظ على Tree structure.

مثال:

```text
Quran Month
├── Week 1
│   ├── Day 1
│   └── Day 2
└── Week 2
```

يجب أن تصبح نسخة:

```text
Quran Month Copy
├── Week 1
│   ├── Day 1
│   └── Day 2
└── Week 2
```

وليس Flat list.

---

# 21) Duplicate Options — Fields

Dialog المقترحة:

```text
Duplicate

Scope (radio — خيار واحد فقط)
(•) Main goal only
( ) Main goal with all subgoals

Copy
[x] Project
[x] Color overrides
[x] Notes
[x] Horizon
[x] Dates / day assignments
[ ] Completion state
```

لكن UI الحقيقي يجب أن يكون أبسط من القائمة السابقة.

المبدأ:
- Completion لا يتم نسخه افتراضيًا.
- العناصر الجديدة تبدأ Uncompleted.

---

# 22) Duplicate Scheduling Semantics

مهم: Timestripe date assignment يتعامل مع التاريخ نفسه، وليس معنى weekday.

المستخدم لا يريد logic مثل:
```text
Saturday stays Saturday
```

بل يريد:
```text
day/date based scheduling
```

## 22.1 مثال

Source:
```text
Oct 13
Oct 14
Oct 15
```

عند duplicate ونقل المجموعة لبداية جديدة، النظام يجب أن يحافظ على:
```text
relative date offsets
```

وليس أسماء أيام الأسبوع.

## 22.2 Relative offset strategy

أفضل rule للـMVP:

لكل Child:

```text
offset = childDate - sourceAnchorDate
newChildDate = targetAnchorDate + offset
```

مثال:

Source anchor:
```text
Oct 10
```

Child:
```text
Oct 13
```

offset:
```text
+3 days
```

Target anchor:
```text
Nov 5
```

New child:
```text
Nov 8
```

هذا هو السلوك الافتراضي.

## 22.3 Month edge cases

لو Date mapping ينتج يومًا خارج Target intended range:

لا يتم التخمين بصمت.

يظهر Preview warning مثل:

```text
2 tasks fall outside the target period.
```

خيارات مستقبلية ممكنة:
- Keep calculated dates
- Leave unscheduled
- Move to last valid day

في الـMVP:  
**الافتراضي الآمن:** Leave unscheduled + warning، إلا لو Implementation Spike أثبت UX أبسط وآمن.

---

# 23) Fast Scheduling — Requirement رئيسية

المشكلة الحالية:

لو Weekly Goal فيها 7 Daily Subgoals، المستخدم لا يريد:

```text
فتح Task
→ Time
→ اختيار يوم
→ إغلاق
→ فتح Task التالية
→ Time
...
```

## 23.1 الهدف

تحديد عدة Tasks ثم تعيين أيامهم من واجهة واحدة.

---

# 24) Fast Scheduler UI

بعد تحديد Tasks:

```text
Schedule
```

يفتح Panel/Modal خفيف.

مثال:

```text
Task                  Day
--------------------------------
30 mins Quran         Oct 13
30 mins Quran         Oct 14
30 mins Quran         Oct 15
30 mins Quran         Oct 16
```

كل Row فيه:
- Task name
- Date picker / day selector
- Clear date

ولا يوجد Time-of-day في الـMVP.

---

# 25) Fast Scheduler Quick Actions

يجب أن يدعم:

## 25.1 Assign Same Day
كل العناصر لنفس التاريخ.

## 25.2 One Per Day
يوزع العناصر بالتتابع:

```text
Task 1 → Oct 13
Task 2 → Oct 14
Task 3 → Oct 15
...
```

## 25.3 Distribute Across Parent Period
إذا كان Parent له نطاق منطقي/زمني معروف، يمكن توزيع children عليه.

تنفذ فقط إذا كان Mapping واضحًا وآمنًا.

## 25.4 Clear Dates
إزالة scheduling من selected goals.

## 25.5 Manual Fast Edit
تعديل جميع التواريخ في نفس الشاشة.

---

# 26) Scheduler لا يدير الساعة

الـMVP لا يحتوي:
- Start time
- End time
- Duration editor على مستوى الساعة

المطلوب فقط:
```text
Assign Day/Date
```

لتقليل Scope.

---

# 27) Save as Template

يمكن تحديد:
- Flat tasks
- Goal tree
- Goal + descendants
- Mixed selection

ثم:

```text
Save as Template
```

Template تحفظ:
- Titles
- Parent-child structure
- Project information
- Color overrides
- Relative date offsets
- Horizon data إن أمكن
- Notes إذا اختار المستخدم

ولا تحفظ Completion بشكل افتراضي.

---

# 28) Template Model

مبدئيًا:

```json
{
  "id": "...",
  "name": "...",
  "createdAt": "...",
  "nodes": [
    {
      "templateNodeId": "...",
      "parentTemplateNodeId": null,
      "title": "...",
      "projectRef": "...",
      "colorOverride": null,
      "relativeDateOffsetDays": 0,
      "horizon": "week"
    }
  ]
}
```

لا نخزن Timestripe Goal IDs داخل Template كاعتماد دائم.

---

# 29) Apply Template

عند Apply:

1. اختيار Template.
2. اختيار target start/anchor date.
3. Preview.
4. Create.

كل العناصر الجديدة:
```text
unchecked / uncompleted
```

بشكل افتراضي.

الـrelative scheduling يتم تطبيقه بنفس قواعد Duplicate.

---

# 30) Templates UI

تكون متاحة من:
- Extension popup
- Timestripe integrated menu

Actions:
- Apply
- Rename
- Duplicate template
- Delete
- Export future-ready

---

# 31) Design Language

الهدف:

> The extension should look like Timestripe shipped it.

## 31.1 ممنوع
- Dashboard ضخم منفصل
- Gradients غريبة
- Design system مختلف
- Components تشبه SaaS generic
- أزرار ضخمة
- Cards زائدة
- Purple AI aesthetic

## 31.2 المطلوب
مطابقة:
- spacing
- typography weight
- menu density
- radius
- overlay darkness
- muted text
- hover behavior
- checkbox proportions
- icon weight
- panel shadows
- modal layout

---

# 32) Dark Theme

الصور المرجعية توضّح:
- خلفيات داكنة جدًا
- borders خفيفة
- secondary text رمادي
- contextual menu أسود/رمادي شديد
- selected/highlight states هادئة

الإضافة يجب ألا تستخدم Hardcoded assumptions غير ضرورية.

---

# 33) Light Theme

يجب دعم Light theme في الـMVP.

الصور المرجعية توضح:
- خلفية بيضاء
- Sidebar رمادي فاتح
- Borders شديدة الخفة
- Menus الداكنة قد تظل داكنة حسب Timestripe
- Task colors pastel/light

---

# 34) Theme Detection

الأفضل:

1. اكتشاف theme من DOM / computed styles.
2. استخراج CSS values من Timestripe قدر الإمكان.
3. وضع fallback tokens داخل الإضافة فقط عند الضرورة.

مثال Tokens:

```text
--tsx-bg
--tsx-surface
--tsx-text
--tsx-muted
--tsx-border
--tsx-hover
--tsx-menu-bg
--tsx-menu-text
```

لكن القيم تشتق قدر الإمكان من الصفحة.

---

# 35) Color Contrast

عند custom project color:

يجب حساب readable foreground.

مثال:
- لون فاتح → text غامق
- لون غامق → text فاتح

يجب الحفاظ على:
- checkbox visibility
- text readability
- hover visibility
- partial selection visibility

---

# 36) RTL / LTR

Requirement أساسية.

يجب دعم:
- Task عربية
- Task إنجليزية
- Mixed Arabic + English
- Project name عربي
- Project name إنجليزي

لا يتم فرض `direction: rtl` على كل Timestripe.

يجب استخدام:
- component-level direction
- `dir="auto"` للنصوص عند الحاجة
- Logical CSS properties مثل:
  - margin-inline
  - padding-inline
  - inset-inline

## 36.1 Text Direction & Alignment Control (مضافة 2026-10-03 — Requirement أساسية)

المستخدم يكتب مهامًا بالعربية والإنجليزية داخل نفس الـspace ويحتاج تحكمًا صريحًا باتجاه النص لكل Task/Note على غرار Word / Google Docs:

- أزرار تحكم (Direction: Auto / RTL / LTR + Alignment) تُحقن في محرر الـnotes وعلى صف الـtask.
- التفضيل يُخزَّن extension-side لكل goal (per-goal direction/alignment preference) ويُطبَّق عند العرض في كل مرة.
- مستويان:
  1. **Auto (افتراضي):** تطبيق `dir="auto"` / `unicode-bidi: plaintext` على العناوين والملاحظات بحيث يظهر كل نص باتجاهه الطبيعي تلقائيًا بدون تدخل.
  2. **Manual override:** المستخدم يثبّت اتجاه/محاذاة عنصر معين، فيتغلب على Auto.
- بند Spike: هل يحفظ محرر Timestripe سمات dir/alignment أصلية داخل description؟ إن نعم تُستخدم الطريقة الأصلية؛ إن لا تُطبَّق كطبقة عرض extension-side (متسقة مع قاعدة §67).
- ينطبق على: task titles، notes، والـUI الجديدة للإضافة نفسها.

---

# 37) Popup

Extension popup ليست Dashboard ثقيلة.

تقترح Tabs بسيطة:

```text
Projects
Templates
Settings
```

## Projects
- Add
- Rename
- Recolor
- Archive/Delete

## Templates
- Apply
- Rename
- Delete

## Settings
- Full Color / Strip
- Show Project Name toggle
- Backup / Restore
- Diagnostics

---

# 38) Storage

استخدام:
```text
chrome.storage.local
```

وليس page localStorage.

Namespaces:

```text
settings
projects
taskProjectLinks
taskColorOverrides
templates
uiState
schemaVersion
```

---

# 39) Backup

## Export
زر:
```text
Export Extension Data
```

ينتج JSON.

يحتوي:
- Projects
- Colors
- Task mappings
- Overrides
- Templates
- Settings

## Import
- Validate schema
- Show preview
- Merge أو Replace
- Confirmation قبل Replace

---

# 40) Data Model — Project Link

مبدئيًا:

```json
{
  "goalId": "timestripe-goal-id",
  "projectId": "local-project-id",
  "projectSource": "explicit"
}
```

Inherited children ليس ضروريًا دائمًا تخزين نفس mapping لهم إذا inheritance يمكن حسابها بثبات.

لكن implementation يقرر بعد Spike حسب:
- API access
- DOM visibility
- performance

ملاحظة صيانة: كل mapping يخزّن `spaceId` معه (see §41.6)، وتُنظَّف الـmappings اليتيمة lazily — عندما تُرجع الـAPI goal غير موجودة (not found) يُحذف الـmapping الخاص بها.

---

# 41) Integration مع Timestripe

المسار المفضل:

```text
Official Timestripe API
```

لعمليات:
- list/get/create/update/delete goals
- parent relations
- horizon
- date
- checked state

أداة Timestripe CLI الرسمية الحالية توضح أن goals لها عمليات إدارة، وأن الأوامر تدعم parent/horizon/date، مع API keys/OAuth.

## Gate مهم

قبل Feature implementation:

يجب عمل Technical Spike يثبت عمليًا على حساب Basic:

1. قراءة Goal.
2. إنشاء Goal.
3. تعديل Goal.
4. حذف Test Goal.
5. تعيين parent.
6. تغيير horizon.
7. تعيين date.
8. التأكد من IDs.
9. التأكد من behavior للـchildren عند delete.
10. التأكد من permissions/CORS داخل Edge Extension.

أي Capability تفشل:
- لا يتم اختراع undocumented behavior.
- يتم تسجيلها كConstraint.
- يتم تحديد fallback واضح.

## 41.5 حالة التحقق الفعلية — 2026-10-03 (Phase 0 جزئيًا منفّذ)

تم التحقق عمليًا بـ API key حقيقي (عمليات قراءة فقط):

- Auth: Bearer token — API key من Settings → API keys يعمل على الحساب. المفتاح له scope على مستوى spaces (All spaces أو spaces محددة) + صلاحية Read only أو Read & write.
- Base URL: `https://timestripe.com/api/v3/` (مؤكدة من OpenAPI spec الرسمي داخل timestripe-cli repo).
- Endpoints مؤكدة: spaces, boards, buckets, goals (CRUD كامل), folders, folder-goals, comments, events (read-only), memberships, users/me — مع pagination وsort وsearch.
- Goal schema الفعلية: `id`, `space_id`, `bucket_id` (optional), `parent_id`, `horizon` (day/week/month/quarter/year/decade/life), `date` (YYYY-MM-DD), `start_time`/`end_time`, `name`, `description` (Markdown), `checked`, `color` (enum من 6 ألوان فقط — يؤكد Risk #6 بأن الألوان المخصصة ستكون extension-only), sequence numbers, `created_datetime`, `url`.
- Boards اختيارية: يمكن أن يحتوي space على goals مباشرة بدون أي board.
- Events feed: timestamps كاملة + goal_id لكل عملية. الأنواع المرصودة: GOAL_CREATED / GOAL_DELETED / GOAL_MODIFIED / GOAL_RESCHEDULED / GOAL_DONE / SPACE_CREATED / USER_CREATED.
- **CORS/permissions من extension service worker: مؤكد عمليًا (2026-10-03)** — GET /users/me/ من داخل الإكستنشن رجّع HTTP 200 بواسطة host_permissions + Bearer key، بدون أي مشكلة.
- الحساب الحالي: space "دنيا" + test space "EXT-TEST".

## 41.5.1 نتائج اختبارات الكتابة — 2026-10-03 (على EXT-TEST)

- **Create:** POST /goals/ يعمل (201) مع parent_id + horizon + date في نفس الطلب، ويرجّع الـobject كامل بالـid فوراً — تدفق §49 (root ثم children level by level) ممكن كما هو.
- **Update:** PATCH يعمل لكل من: `checked` (تعليم done وإلغاؤه restart)، `date` (reschedule)، `color` (من enum الـ6 فقط — القيم غير الصالحة تُرفض بـ400 واضحة، تأكيد إضافي أن الألوان المخصصة extension-only)، `color: null` (reset)، `description` (Markdown — النص العربي يُحفظ سليماً).
- **Events:** تعلم done يطلق `GOAL_DONE`. **إلغاء التعلم (uncheck) لا يطلق أي event في الـfeed** — فجوة مهمة للـ§41.7.
- **حذف الـParent يحذف الـChildren تلقائياً (cascade):** بعد DELETE للأب، الـchildren ترجع 404 وتظهر GOAL_DELETED لكل منها. الآثار المباشرة:
  - Bulk Delete (§18) يجب أن يُطبِّع الـselection ليعمل على أعلى العناصر المحددة فقط (تجنب double-delete على children ستُحذف تلقائياً).
  - Undo للـDuplicate (§51) يصبح عملية واحدة: حذف الـroot الجديد يمسح النسخة كاملة بشجرتها.
  - الـGOAL_DELETED بعد الحذف يفقد goal_id (يبقى goal_name فقط) — لا يمكن ربط الـevent بالـid لاحقاً.
- EXT-TEST أُعيد لتفريغه بالكامل بعد الـSpike (0 goals).

## 41.5.2 نتائج الـ DOM Probe — 2026-10-03 (فحص صفحة Horizons الحقيقية)

تم فحص `https://timestripe.com/horizons/today/` (689 عنصر) — النتائج تحسم معمارية الـAdapter:

- **Goal ID مكشوف في الـ DOM (حسم السؤال المصيري):** كل صف هدف ملفوف في
  `<div class="GoalRowWrapper" data-draggable-id="1-8020::goal:{GOAL_ID}">` — الاستخراج بـregex من `::goal:` يربط الصف بالـAPI مباشرة بدون أي title-matching. البادئة (`1-8020`) تطابق `data-droppable-id` لحاوية `.Goals` (معرّف قائمة dnd-kit).
- **الألوان آلية CSS أصلية:** `.GoalRow` يحمل `style="--GoalRow-color: R, G, B; --GoalRow-color-text: R, G, B"` — Timestripe نفسها ترسم ألوان الصفوف من CSS variables بصيغة RGB triplet. النتيجة: ألوان المشاريع المخصصة تُطبَّق بضبط المتغير نفسه (Full Color Mode شبه مجاني)، مع لون النص المتوافق عبر `--GoalRow-color-text`.
- **بنية الصف:** `.Goals > .Goals-list > .GoalRowWrapper > … > .GoalRow(. _is_subgoal) > .GoalRow-content > [role="checkbox"]` — الـcompletion أصلًا `[role="checkbox"]` (a11y سليم و16 عنصر ظهروا في الفحص)، و`_is_subgoal` يكشف التسلسل الهرمي على مستوى الصف.
- **SPA navigation:** `.App[data-route="/horizons/"]` — تتبع التنقل بمراقبة سمة `data-route` (mutate observer).
- **Context menus:** أزرار `Menu-target … GoalsOptionsButtons-option` مع `aria-haspopup="menu"` و`data-is-menu-reference="true"` — نقطة حقن مدخلات القائمة (§55).
- **مفيش React internals مكشوفة** على العناصر المفحوصة (لكن فيه أنماط `useId` مثل `:rr:`) — غير مهم: الـID موجود في الـDOM مباشرة.
- `data--h-bstatus="0OBSERVED"` على كل العناصر — instrumentation داخلية من الموقع، تُتجاهل.

**القرار النهائي للربط DOM↔API:** عبر `data-draggable-id` — مفيش حاجة لأي fallback في الـMVP. الـTimestripeDomAdapter (§47) يُبنى فوق هذه الـselectors.

## 41.6 Space Scoping — قرار

الـAPI account-global والمفتاح يُمنح صلاحية على spaces محددة (أو All spaces)، وكل requests تُوجَّه لـspace محدد بـ`space_id`:

- الإضافة تحتفظ بإعداد "Active Space": تجيب قائمة spaces عبر `GET /spaces/` والمستخدم يختار.
- كل بيانات الإضافة المحلية (projects, mappings, overrides, templates, event log) تُخزَّن namespaced بـ`spaceId` لتفادي التعارض عند وجود spaces متعددة مستقبلًا.
- الـkey يُخزَّن في `chrome.storage.local` فقط، لا يدخل الـbundle، ولا يُرسل لأي جهة غير timestripe.com.

## 41.7 Future Integration — Gamification Site (خارج الـMVP، لكن له آثار معمارية الآن)

المستخدم يخطط مستقبلًا لموقع شخصي (points / shop) يحسب أرقامه من حالة مهامه (completed / missed / streaks)، وقد تكون الإضافة مصدر هذه الأرقام للموقع.

القرارات المعمارية المبكرة (بدون تنفيذ في الـMVP):

1. **Stats Engine كوحدة مستقلة:** دوال pure تحسب المقاييس من شجرة الـgoals (completion, dates, streaks, missed) — قابلة للاختبار منفصلة، ويُعاد استخدامها لاحقًا في الـsync.
2. **مصدر البيانات: الـAPI مباشرة (أُكد عمليًا 2026-10-03):** الـevents feed يسجل `GOAL_DONE` بـtimestamps وgoal_id، فموقع اللعبة يستطيع قراءة تاريخ الـcompletions مباشرة من Timestripe API بمفتاح read-only منفصل — بدون أي اعتماد على الإكستنشن. **الاستثناء الوحيد:** إلغاء التعلم (uncheck) لا يطلق أي event في الـAPI — إن كانت reopen timestamps مهمة للـgame فالـActivity Event Log المحلي للإضافة (يرصد الـtransitions لحظياً أثناء التصفح) هو المصدر الوحيد الممكن لها؛ إن لم تكن مهمة يُلغى الـlog ويُكتفى بـreconciliation حالة الـgoals الحالية عند كل قراءة. القرار النهائي عند بدء مشروع اللعبة نفسه.
3. **Sync Adapter كواجهة مجردة:** interface واحد (connect / pushStats / status) بدون implementation في الـMVP — عند جهوزية موقع اللعبة يُنفَّذ الـadapter فقط دون تغيير باقي الإضافة. مسار بديل محتمل: backend موقع اللعبة يقرأ Timestripe API مباشرة (server-to-server) بدون وسيط الإضافة — القرار مؤجل حتى تأكيد سلوك الـevents.
4. **Real-time واقعي مع MV3:** الـservice worker غير دائم؛ القرب من real-time يتحقق عبر: تنفيذ فوري عند رصد تغيير (content script → message → SW) + `chrome.alarms` للـreconciliation الدوري. كافٍ لمنظومة شخصية.
5. **Permissions:** إضافة host permission لنطاق موقع اللعبة تتم لاحقًا عبر optional permissions عند تفعيل الـsync فقط — لا تُطلب في الـMVP.
6. **Auth للموقع:** قرار مؤجل — الأرجح token يُدخل يدويًا في إعدادات الإضافة ويُخزَّن محليًا (نفس نمط مفتاح Timestripe).

---

# 42) API Authentication

الـMVP يفضل:
- Personal API key إذا كان متاحًا ومناسبًا.
- لا يتم حفظه داخل source code.
- يخزن باستخدام extension storage فقط إذا لزم.
- لا يتم إرساله لأي جهة غير Timestripe.

OAuth يمكن أن يكون Future Enhancement إذا احتاج المشروع Distribution أوسع.

---

# 43) Manifest V3

المشروع يستخدم:
```text
manifest_version: 3
```

Architecture المقترحة:

```text
content script
    ↕
service worker
    ↕
Timestripe API

popup/options
    ↕
chrome.storage.local
```

---

# 44) Content Script

مسؤول عن:
- اكتشاف Timestripe UI
- حقن Project UI
- إظهار project indicators
- Selection UX
- Context menu extensions
- Theme detection
- MutationObserver أو equivalent
- Reactivity مع SPA navigation

لا يحمل Business Logic حساس بزيادة.

---

# 45) Service Worker

مسؤول عن:
- API calls
- storage orchestration
- duplicate execution
- template creation execution
- batch update
- retry/error handling
- transactional-ish job tracking

لا يعتمد على in-memory state فقط لأن MV3 service worker يمكن أن يتوقف.

---

# 46) SPA Awareness

Timestripe UI ديناميكية.

لا نفترض:
```text
page load once
```

يجب التعامل مع:
- route changes
- dynamic modals
- collapsing subgoals
- Horizon changes
- re-rendering

ويفضل:
- stable selectors إن وجدت
- semantic anchors
- minimal MutationObserver scope
- debouncing

---

# 47) DOM Robustness

لا تعتمد على selectors مثل:

```text
div:nth-child(7) > span:nth-child(2)
```

إلا كحل مؤقت جدًا.

يجب بناء selector adapter layer.

مثال:

```text
TimestripeDomAdapter
  findGoalRow()
  getGoalId()
  observeGoalList()
  injectProjectBadge()
```

بحيث لو تغير DOM يتم تعديل Adapter بدل كل المشروع.

---

# 48) Error Handling

Bulk operation قد تنجح جزئيًا.

مثال:
```text
10 selected
8 updated
2 failed
```

يجب عرض:
```text
8 completed
2 failed
[Retry failed]
[View details]
```

لا يتم القول "Done" إذا هناك failures.

---

# 49) Duplicate Execution Safety

عند Duplicate Tree:

الترتيب:

1. إنشاء root
2. الحصول على new root ID
3. إنشاء children level 1
4. ربطهم بالـnew parent IDs
5. recursion / breadth-first
6. apply dates/projects/metadata
7. verify result

لا يتم إنشاء Child قبل وجود Parent الجديد.

---

# 50) Idempotency / Double Click

يجب منع:
- double-click duplicate
- double Apply Template
- repeated API retry ينشئ نسختين

على الأقل داخل الـMVP:
- lock العملية أثناء التنفيذ
- operation ID
- disable CTA
- safe retry logic

---

# 51) Undo

Undo ليس ممكنًا بنفس القوة لكل شيء.

## Selection Undo
ضروري.

## Change Project / Color
يفضل Undo.

## Schedule
يفضل snapshot للتواريخ القديمة ثم Undo.

## Delete
إذا API لا توفر restore:
- Confirmation قوي.
- لا ندعي وجود Undo.

## Duplicate
Undo يمكن أن يكون:
```text
Delete newly created copy
```
إذا تم تسجيل IDs الجديدة.

---

# 52) Performance

لا يجوز أن تسبب الإضافة Lag في Horizons.

Targets مبدئية:
- Injection غير ملحوظ.
- Re-render محدود.
- Batch storage.
- Debounced DOM observers.
- عدم إعادة scan الصفحة كلها كل mutation.

اختبار على:
- 20 tasks
- 100 tasks
- deeply nested tree
- several horizons visible

---

# 53) Accessibility

حتى لو Timestripe نفسها لها نمط معين:

الـUI الجديدة يجب أن تحتوي على:
- keyboard focus
- visible focus state
- aria-label
- ESC لإغلاق dialogs
- Enter للتأكيد
- Tab navigation
- contrast معقول

---

# 54) Keyboard UX

مقترحات داخل الـMVP إذا سهلة:

```text
Esc → Cancel selection / close modal
Ctrl/Cmd + Z → extension undo when safe
Shift click → range selection إذا أمكن
```

Shift-select ليست Blocker للـMVP إن صعبت.

---

# 55) Context Menu Integration

عند `...` الخاص بالـTask يمكن إضافة Entries مثل:

```text
Project
Color override
Select
Duplicate with options
Save as template
```

لكن لا نحشر كل شيء في القائمة.

العمليات الجماعية تكون في Selection Manager.

---

# 56) Fast Scheduler UX Flow

مثال كامل:

1. المستخدم يفتح Weekly Goal.
2. يحدد 7 Daily Subgoals.
3. يضغط Schedule.
4. تظهر rows السبعة.
5. يضغط:
   ```text
   One per day
   ```
6. يختار Start Date:
   ```text
   Oct 13
   ```
7. Preview:
   ```text
   13, 14, 15, 16, 17, 18, 19
   ```
8. Apply.
9. النتيجة تظهر فورًا في Horizons.

---

# 57) Duplicate UX Flow

مثال:

المستخدم عنده Monthly Goal للقرآن شبيه Monthly Goal للكورسات.

1. يفتح Goal.
2. Duplicate.
3. Dialog:
   ```text
   Duplicate main goal only
   Duplicate with subgoals
   ```
4. يختار:
   ```text
   Duplicate with subgoals
   ```
5. Preserve:
   - hierarchy
   - date offsets
   - project? yes
   - colors? yes
6. Create.
7. يغير Project إلى Courses.
8. يعدل Titles المطلوبة فقط.

الهدف هو توفير أكبر قدر من manual setup.

---

# 58) Design Reference Screens

يجب استخدام screenshots التي وفرها المستخدم كمرجع:

- Dark Days Horizon
- Dark modal
- Dark contextual menu
- Light Days Horizon
- Light modal
- Light contextual menu
- Colored Goals
- Subgoal collapsed/expanded states

الـAgent المنفذ يجب أن يقارن UI الفعلية بالصور أثناء التنفيذ.

---

# 59) Testing Strategy

## 59.1 Unit Tests

لـ:
- project inheritance
- color inheritance
- overrides
- selection normalization
- partial selection
- duplicate tree transform
- relative date offsets
- template serialization
- backup schema validation

## 59.2 Integration Tests

لـ:
- storage
- service worker messaging
- API adapter
- batch operations
- retries

## 59.3 E2E

على Timestripe الحقيقي أو test account:

- Add Project
- Assign task
- Inherit to subgoal
- Override child project
- Switch themes
- Multi-select parent
- Exclude child
- Duplicate tree
- Bulk schedule
- Save template
- Apply template
- Export/import

## 59.4 Regression Tests

Selectors وDOM integration تعتبر risk عالي.

يجب عمل tests تكشف:
```text
Goal row not detected
Menu not found
Modal changed
Goal ID extraction failed
```

---

# 60) MVP Acceptance Criteria

الـMVP يعتبر ناجحًا إذا:

### Projects
- المستخدم يعمل Project.
- يختار له أي لون.
- يسنده لـTask.
- الاسم/اللون يظهران في Daily Horizon.
- Subgoals ترث Project.
- Override يعمل.

### Colors
- أكثر من 6 ألوان.
- Full/Strip mode.
- Light/Dark readable.

### Multi-select
- تحديد عدة Tasks.
- Parent يحدد descendants.
- Child يمكن استبعاده.
- Partial state يعمل.
- Custom selection لا تضيع بصمت.

### Duplicate
- Main goal only يعمل.
- With subgoals يعمل.
- Tree structure محفوظة.
- Relative dates محفوظة.
- Copies تبدأ uncompleted.

### Fast Scheduler
- تحديد عدة Tasks.
- Assign date لكل واحدة من نفس Panel.
- One per day يعمل.
- لا حاجة لفتح كل Task منفردة.

### Templates
- Save selection as template.
- Apply with new anchor date.
- Hierarchy محفوظة.

### Reliability
- No silent partial failure.
- No duplicate accidental requests.
- Backup/restore يعمل.

---

# 61) Implementation Phases

## Phase 0 — Technical Discovery
قبل بناء Features:

- inspect Timestripe DOM
- inspect route behavior
- verify official API
- verify Basic account API permissions
- verify goal CRUD
- verify parent/date/horizon
- verify CORS
- identify stable goal IDs
- map dark/light tokens

Deliverable:
```text
TECHNICAL_DISCOVERY.md findings
```

لكن في المشروع النهائي يتم دمج النتائج مع هذا الملف بدل إنشاء Specification جديدة منفصلة إن أمكن.

> **حالة 2026-10-03 — Phase 0 مكتملة ✅:** الـAPI (قراءة/كتابة/CORS/events) مؤكد (§41.5، §41.5.1)، والـDOM مؤكد (§41.5.2: الـgoal ID مكشوف في `data-draggable-id`، الألوان آلية CSS variables أصلية، SPA navigation عبر `data-route`). استخراج الـtheme tokens (dark/light) يتم أثناء بناء الـtheme adapter في Phase 1/2 بدل spike منفصل — النمط واضح من `--GoalRow-color`. **لا يوجد أي blocker — يبدأ تنفيذ Phase 1/2 فورًا.**

## Phase 1 — Foundation
- MV3 project
- storage
- content script
- service worker
- DOM adapter
- theme adapter
- popup skeleton

## Phase 2 — Projects & Colors
- CRUD
- assignment
- inheritance
- overrides
- indicators
- full/strip modes

## Phase 3 — Multi-select
- Selection Manager
- tree selection
- partial state
- undo
- cross-view persistence

## Phase 4 — Bulk Actions
- project
- color
- delete
- schedule

## Phase 5 — Smart Duplicate
- main only
- recursive
- date offsets
- preview
- rollback IDs

## Phase 6 — Templates
- save
- apply
- manage

## Phase 7 — QA & Hardening
- light/dark
- RTL
- performance
- API failures
- DOM regressions
- large trees

---

# 62) Skills / Guidance Recommended

المشروع يستفيد من:

1. Official Chrome extension guidance / Manifest V3
2. Chrome extension architecture guidance
3. Browser automation / GUI testing
4. Frontend design skill
5. React best practices إذا تم اختيار React

لا توجد حاجة في الـMVP إلى:
- Clerk
- Backend framework
- Database skill
- Auth SaaS

---

# 63) Tech Choice

لا يتم إجبار React إذا Vanilla مناسب.

لكن إذا UI بدأت تشمل:
- Selection Manager
- Scheduler modal
- Templates
- Popup
- Project manager

فـReact + Vite/CRXJS قد يجعل التطوير والاختبار أسهل.

القرار النهائي بعد Phase 0.

الأولوية:
```text
maintainability > framework preference
```

---

# 64) Security

- أقل Permissions ممكنة.
- Host permission لـTimestripe فقط.
- لا `<all_urls>` بدون سبب.
- لا Remote JS.
- لا eval.
- لا API key داخل bundle.
- لا logging لمحتوى Notes الحساسة بدون حاجة.
- لا إرسال telemetry خارجي في الـMVP.

---

# 65) Privacy

الإضافة شخصية ومحلية.

Default:
```text
No telemetry
No analytics
No third-party backend
```

---

# 66) Known Risks

1. Timestripe DOM قد يتغير.
2. API limits/plan restrictions قد تظهر.
3. بعض Goal metadata قد لا تكون exposed بسهولة.
4. CORS/Auth من Extension يحتاج اختبار.
5. Delete semantics مع nested goals تحتاج verification.
6. Native color fields محدودة، لذلك custom colors قد تكون extension-only.
7. Mobile Timestripe لن يعرض custom Projects/Colors الخاصة بالإضافة.

---

# 67) Important Product Decision

Projects والألوان المخصصة تعتبر Enhancement Layer.

يعني:
- Timestripe يظل usable بدون extension.
- البيانات الأصلية لا يتم إفسادها.
- لو الإضافة تعطلت، Goals نفسها تظل موجودة.

هذه قاعدة Architecture مهمة.

---

# 68) Final MVP Summary

النسخة الأولى المطلوبة عمليًا تجعل Workflow المستخدم كالآتي:

```text
1. أنشئ Project: Quran
2. اختار لونًا
3. أنشئ Monthly Goal
4. عيّنه لـQuran
5. Subgoals الأسبوعية ترث Quran
6. Daily subgoals ترث Quran
7. في Daily Horizon يظهر Quran + اللون
8. حدد عدة subgoals
9. Schedule → One per day
10. Duplicate Goal:
    - main only
    - or with entire tree
11. Preserve relative dates
12. غيّر Project للنسخة الجديدة إلى Courses
13. احفظ structures المتكررة كTemplates
```

أهم مقياس نجاح:

> التخطيط الهرمي المتكرر الذي كان يحتاج عشرات الفتحات والضغطات داخل Timestripe يصبح عملية Bulk سريعة ومفهومة، مع الحفاظ على شكل Timestripe الأصلي.

---

# 69) Sources / Technical References

- Timestripe API: https://timestripe.com/api/
- Official Timestripe CLI: https://github.com/timestripe/timestripe-cli
- Microsoft Edge Extensions Docs: https://learn.microsoft.com/en-us/microsoft-edge/extensions/
- Edge Manifest Format: https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/manifest-format
- Edge Supported Extension APIs: https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support
- Chrome Extension Storage: https://developer.chrome.com/docs/extensions/reference/api/storage
- Chrome Scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting

---

# 70) Instruction to the Coding Agent

قبل كتابة Production code:

1. اقرأ هذا الملف كاملًا.
2. لا تغيّر UX decisions بدون سبب موثق.
3. نفذ Phase 0 أولًا.
4. لا تفترض API capability لم يتم اختبارها.
5. لا تستخدم private/undocumented endpoints كاعتماد أساسي بدون توثيق القرار والمخاطر.
6. حافظ على Timestripe-native design.
7. اختبر Dark + Light.
8. اختبر RTL.
9. اختبر nested goals بعمق أكبر من مستوى واحد.
10. لا تعتبر feature مكتملة بدون acceptance tests.

</div>
