// 資料模型：和 iOS 版的備份檔（JSON）格式相同，兩邊的備份檔可以互通。
// 全部資料 → 學期（學生名冊＋科目）→ 科目（學生、成績、分組、打掃、檢查表）
// 資料都是一般的物件；ID 是大寫的 UUID 字串，日期是 ISO 8601 字串，沒有值的欄位用 null。

import { trimmed, normalizeSeat, startOfDay, isSameDay, toDate } from './format.js';

export const SCHEMA_VERSION = 2;

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().toUpperCase();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }).toUpperCase();
}

export const nowISO = () => new Date().toISOString();

// MARK: 班級、組別排序

const STEMS = [...'甲乙丙丁戊己庚辛壬癸'];
const NUMERALS = [...'一二三四五六七八九'];

function chineseNumber(chars) {
  const digit = (c) => NUMERALS.indexOf(c) + 1;
  const ten = chars.indexOf('十');
  if (ten >= 0) {
    const tens = ten === 0 ? 1 : digit(chars[ten - 1]);
    const ones = ten + 1 < chars.length ? digit(chars[ten + 1]) : 0;
    return tens * 10 + ones;
  }
  return chars.reduce((n, c) => n * 10 + digit(c), 0);
}

function naturalParts(name) {
  const result = [];
  let text = '';
  let digits = '';
  let chinese = [];
  const flush = () => {
    if (text) { result.push([1, text]); text = ''; }
    if (digits) { result.push([0, Number(digits)]); digits = ''; }
    if (chinese.length) { result.push([0, chineseNumber(chinese)]); chinese = []; }
  };
  for (const ch of name) {
    if (ch >= '0' && ch <= '9') {
      if (!digits) flush();
      digits += ch;
    } else if (NUMERALS.includes(ch) || ch === '十') {
      if (!chinese.length) flush();
      chinese.push(ch);
    } else if (STEMS.includes(ch)) {
      flush();
      result.push([0, STEMS.indexOf(ch) + 1]);
    } else {
      if (!text) flush();
      text += ch;
    }
  }
  flush();
  return result;
}

/** 班級、組別名稱排序：甲乙丙丁、一二三、數字都依順序；空字串排最後。回傳負數代表 a 在前。 */
export function naturalCompare(a, b) {
  a = a ?? ''; b = b ?? '';
  if (!a !== !b) return a ? -1 : 1;
  const pa = naturalParts(a), pb = naturalParts(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const [ka, va] = pa[i], [kb, vb] = pb[i];
    if (ka !== kb) return ka - kb;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  if (pa.length !== pb.length) return pa.length - pb.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

const collator = new Intl.Collator('zh-Hant', { numeric: true });

/** 依班級、座號排序（數字依大小，沒有座號的排最後），座號相同再依姓名 */
export function sortBySeat(list) {
  return [...list].sort((a, b) => {
    if ((a.className ?? '') !== (b.className ?? '')) return naturalCompare(a.className, b.className);
    const x = /^\d+$/.test(a.seat) ? Number(a.seat) : null;
    const y = /^\d+$/.test(b.seat) ? Number(b.seat) : null;
    if (x !== null && y !== null) { if (x !== y) return x - y; }
    else if (x !== null) return -1;
    else if (y !== null) return 1;
    else if (a.seat !== b.seat) {
      if (!a.seat) return 1;
      if (!b.seat) return -1;
      return collator.compare(a.seat, b.seat);
    }
    return collator.compare(a.name, b.name);
  });
}

// MARK: 建立新資料

export function defaultCategories() {
  return [['操作', 30], ['作業', 10], ['實驗報告', 30], ['考試', 30]]
    .map(([name, weight], i) => ({ id: uuid(), name, weight, colorIndex: i }));
}

export function defaultDuties() {
  return ['實驗桌', '水槽', '地板', '廢液桶', '器材櫃', '領班', '藥品', '器材'].map((name) => newDuty(name));
}

export function newDuty(name, note = '', studentIDs = [], section = null) {
  return { id: uuid(), name, note, studentIDs, section };
}

export function defaultGradeSettings() {
  return { categoryMode: 'averagePercent', blankAsZero: false, totalDecimals: 1, passLine: 60 };
}

export function newSubject(name) {
  return {
    id: uuid(), name, createdAt: nowISO(), students: [], categories: defaultCategories(), items: [], scores: {},
    gradeSettings: defaultGradeSettings(), groupSets: [], activeGroupSetID: null, officers: [],
    duties: defaultDuties(), dutyChecks: [],
  };
}

export function newStudent({ seat = '', studentNo = '', name = '', note = '', className = '', rosterID = null }) {
  return { id: uuid(), seat, studentNo, name, note, className, rosterID };
}

export function newRosterStudent({ className = '', seat = '', studentNo = '', name = '' }) {
  return { id: uuid(), className, seat, studentNo, name };
}

export function newSemester(name, roster = [], subjects = []) {
  return { id: uuid(), name, createdAt: nowISO(), roster, subjects, currentSubjectID: subjects[0]?.id ?? null };
}

export function newGroupSet(name) {
  return { id: uuid(), name, groupSize: 4, groups: [], createdAt: nowISO(), sectionCount: null };
}

export function newGroup({ name, leaderID = null, memberIDs = [], section = null, id = uuid() }) {
  return { id, name, leaderID, memberIDs, section };
}

export function emptyData() {
  return { app: '實習課管理', schemaVersion: SCHEMA_VERSION, semesters: [], currentSemesterID: null, lastBackupExportAt: null };
}

// MARK: 學期名稱

/** 依日期推算學期名稱：8 月～隔年 1 月是第 1 學期，2～7 月是第 2 學期；學年度 = 西元年 − 1911 */
export function termName(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const academic = (month >= 8 ? year : year - 1) - 1911;
  const term = (month >= 8 || month === 1) ? 1 : 2;
  return `${academic}學年度第${term}學期`;
}

/** 下一個學期：「115學年度第1學期」→「115學年度第2學期」→「116學年度第1學期」 */
export function nextTermName(name) {
  const m = /(\d+)學年度第([12])學期/.exec(name);
  if (!m) return null;
  const year = Number(m[1]);
  return m[2] === '1' ? `${year}學年度第2學期` : `${year + 1}學年度第1學期`;
}

// MARK: 全部資料

export function currentSemester(data) {
  return data.semesters.find((s) => s.id === data.currentSemesterID) ?? data.semesters[0] ?? null;
}

export function allSubjects(data) {
  return data.semesters.flatMap((s) => s.subjects);
}

// MARK: 學期

export function semesterClassNames(sem) {
  const names = [...new Set(sem.roster.map((r) => r.className))];
  return names.sort(naturalCompare);
}

export function studentsInClass(sem, name) {
  return sortBySeat(sem.roster.filter((r) => r.className === name));
}

export function currentSubject(sem) {
  if (!sem) return null;
  return sem.subjects.find((s) => s.id === sem.currentSubjectID) ?? sem.subjects[0] ?? null;
}

export function subjectCountFor(sem, rosterID) {
  return sem.subjects.filter((s) => s.students.some((st) => st.rosterID === rosterID)).length;
}

/** 學生名冊改了姓名、學號或班級後，同步到各科目（座號和備註是各科目自己的，不動） */
export function syncSubjectStudents(sem) {
  const byID = new Map(sem.roster.map((r) => [r.id, r]));
  for (const subject of sem.subjects) {
    for (const st of subject.students) {
      const r = st.rosterID && byID.get(st.rosterID);
      if (!r) continue;
      st.name = r.name;
      st.studentNo = r.studentNo;
      st.className = r.className;
    }
  }
}

/** 把科目裡還沒對應到學生名冊的學生加進名冊（舊資料和範例資料用）：學號相同的視為同一人 */
export function linkStudentsToRoster(sem, subject) {
  for (const st of subject.students) {
    if (st.rosterID && sem.roster.some((r) => r.id === st.rosterID)) continue;
    const match = sem.roster.find((r) => st.studentNo
      ? r.studentNo === st.studentNo
      : (!r.studentNo && r.name === st.name && r.className === st.className));
    if (match) {
      st.rosterID = match.id;
    } else {
      const r = newRosterStudent({ className: st.className, seat: st.seat, studentNo: st.studentNo, name: st.name });
      sem.roster.push(r);
      st.rosterID = r.id;
    }
  }
}

// MARK: 科目

export const sortedStudents = (s) => sortBySeat(s.students);

export function sortedItems(s) {
  return [...s.items].sort((a, b) => {
    const da = toDate(a.date) - toDate(b.date);
    if (da !== 0) return da;
    return toDate(a.createdAt) - toDate(b.createdAt);
  });
}

export const weightTotal = (s) => s.categories.reduce((t, c) => t + Number(c.weight || 0), 0);
export const weightsAreValid = (s) => Math.abs(weightTotal(s) - 100) < 0.001;
export const hasMultipleClasses = (s) => new Set(s.students.map((st) => st.className)).size > 1;
export const studentsByID = (s) => new Map(s.students.map((st) => [st.id, st]));
export const categoryOf = (s, id) => s.categories.find((c) => c.id === id) ?? null;
export const getScore = (s, itemID, studentID) => s.scores[itemID]?.[studentID];

export function activeGroupSet(s) {
  return s.groupSets.find((g) => g.id === s.activeGroupSetID) ?? s.groupSets[0] ?? null;
}

// MARK: 分組

export function groupSections(set) {
  const seen = [];
  for (const g of set?.groups ?? []) if (g.section && !seen.includes(g.section)) seen.push(g.section);
  return seen;
}

export const hasSections = (set) => set.groups.some((g) => g.section);
export const fullGroupName = (g) => (g.section ?? '') + g.name;

/** 大組名稱：0 → A大組、1 → B大組 */
export const sectionName = (i) => `${String.fromCharCode(65 + (i % 26))}大組`;

export function nextSectionName(set) {
  const used = new Set(groupSections(set));
  for (let i = 0; i < 26; i++) if (!used.has(sectionName(i))) return sectionName(i);
  return '新大組';
}

/** 在某個大組（null 代表不分大組）新增一組時的預設組名：第N組，跳過已經用過的 */
export function nextGroupName(set, section) {
  const inSection = (set?.groups ?? []).filter((g) => (g.section ?? null) === (section ?? null));
  const names = new Set(inSection.map((g) => g.name));
  let n = inSection.length + 1;
  while (names.has(`第${n}組`)) n++;
  return `第${n}組`;
}

/** 組員依座號，組長排第一個 */
export function orderedMembers(group, byID) {
  const members = sortBySeat(group.memberIDs.map((id) => byID.get(id)).filter(Boolean));
  const i = members.findIndex((m) => m.id === group.leaderID);
  if (i > 0) members.unshift(...members.splice(i, 1));
  return members;
}

export function unassignedStudents(subject, set) {
  const assigned = new Set(set.groups.flatMap((g) => g.memberIDs));
  return sortedStudents(subject).filter((s) => !assigned.has(s.id));
}

// MARK: 打掃工作的大組

/** 打掃分頁可以切換的大組：目前使用的分組方案裡的大組，加上打掃工作用到、但方案裡已經沒有的大組 */
export function dutySections(s) {
  const result = groupSections(activeGroupSet(s));
  for (const d of s.duties) if (d.section && !result.includes(d.section)) result.push(d.section);
  return result;
}

export const dutiesIn = (s, section) => s.duties.filter((d) => (d.section ?? null) === (section ?? null));

/** 學生在目前使用的分組方案裡屬於哪個大組 */
export function dutySectionByStudent(s) {
  const map = new Map();
  for (const g of activeGroupSet(s)?.groups ?? []) {
    if (!g.section) continue;
    for (const m of g.memberIDs) map.set(m, g.section);
  }
  return map;
}

/** 某個大組的學生；null 代表全部學生 */
export function studentsInSection(s, section) {
  if (!section) return sortedStudents(s);
  const map = dutySectionByStudent(s);
  return sortedStudents(s).filter((st) => map.get(st.id) === section);
}

export function dutyCheck(s, date, section) {
  return s.dutyChecks.find((c) => (c.section ?? null) === (section ?? null) && isSameDay(c.date, date)) ?? null;
}

/** 某個大組的檢查紀錄，日期由舊到新 */
export function dutyCheckDays(s, section) {
  return s.dutyChecks.filter((c) => (c.section ?? null) === (section ?? null))
    .sort((a, b) => toDate(a.date) - toDate(b.date));
}

export const checkResult = (day, dutyID) => day?.results?.[dutyID];

// MARK: 維護

/** 刪除學生，並清掉他的分數、組員資格、組長身分和打掃指派 */
export function removeStudents(s, ids) {
  if (!ids.size) return;
  s.students = s.students.filter((st) => !ids.has(st.id));
  for (const map of Object.values(s.scores)) for (const id of ids) delete map[id];
  for (const set of s.groupSets) {
    for (const g of set.groups) {
      g.memberIDs = g.memberIDs.filter((m) => !ids.has(m));
      if (g.leaderID && ids.has(g.leaderID)) g.leaderID = null;
    }
  }
  for (const d of s.duties) d.studentIDs = d.studentIDs.filter((m) => !ids.has(m));
}

/** 舊版有獨立的「幹部」清單：有用到的併進打掃 */
function mergeLegacyOfficers(s) {
  if (!s.officers?.length) return;
  for (const role of s.officers) {
    if (!role.studentIDs?.length && !trimmed(role.note)) continue;
    const d = s.duties.find((x) => x.name === role.name);
    if (d) {
      for (const id of role.studentIDs) if (!d.studentIDs.includes(id)) d.studentIDs.push(id);
      if (!trimmed(d.note)) d.note = role.note;
    } else {
      s.duties.push({ ...role, section: null });
    }
  }
  s.officers = [];
}

// MARK: 讀入（含舊版格式）

const opt = (v) => (v === undefined ? null : v);

function normalizeSubject(raw) {
  const s = {
    id: raw.id ?? uuid(),
    name: raw.name ?? '未命名科目',
    createdAt: raw.createdAt ?? nowISO(),
    students: (raw.students ?? []).map((st) => ({
      id: st.id ?? uuid(), seat: st.seat ?? '', studentNo: st.studentNo ?? '', name: st.name ?? '',
      note: st.note ?? '', className: st.className ?? '', rosterID: opt(st.rosterID),
    })),
    categories: raw.categories ?? defaultCategories(),
    items: (raw.items ?? []).map((it) => ({
      id: it.id ?? uuid(), name: it.name ?? '未命名項目', categoryID: it.categoryID,
      date: it.date ?? nowISO(), fullScore: it.fullScore ?? 100, createdAt: it.createdAt ?? it.date ?? nowISO(),
    })),
    scores: {},
    gradeSettings: { ...defaultGradeSettings(), ...(raw.gradeSettings ?? {}) },
    groupSets: (raw.groupSets ?? []).map((g) => ({
      id: g.id ?? uuid(), name: g.name ?? '分組', groupSize: g.groupSize ?? 4,
      groups: (g.groups ?? []).map((x) => ({
        id: x.id ?? uuid(), name: x.name ?? '', leaderID: opt(x.leaderID), memberIDs: x.memberIDs ?? [], section: opt(x.section),
      })),
      createdAt: g.createdAt ?? nowISO(), sectionCount: opt(g.sectionCount),
    })),
    activeGroupSetID: opt(raw.activeGroupSetID),
    officers: raw.officers ?? [],
    duties: (raw.duties ?? []).map((d) => ({
      id: d.id ?? uuid(), name: d.name ?? '', note: d.note ?? '', studentIDs: d.studentIDs ?? [], section: opt(d.section),
    })),
    dutyChecks: (raw.dutyChecks ?? []).map((c) => ({
      id: c.id ?? uuid(), date: c.date, section: opt(c.section), results: c.results ?? {}, note: c.note ?? '',
    })),
  };
  // 分數：數字、「缺」、「免」（舊檔可能把數字存成字串）
  for (const [itemID, map] of Object.entries(raw.scores ?? {})) {
    const out = {};
    for (const [studentID, v] of Object.entries(map ?? {})) {
      if (v === '缺' || v === '免') out[studentID] = v;
      else if (typeof v === 'number') out[studentID] = v;
      else if (v !== null && v !== '' && Number.isFinite(Number(v))) out[studentID] = Number(v);
    }
    s.scores[itemID] = out;
  }
  mergeLegacyOfficers(s);
  return s;
}

function normalizeSemester(raw) {
  return {
    id: raw.id ?? uuid(),
    name: raw.name ?? termName(),
    createdAt: raw.createdAt ?? nowISO(),
    roster: (raw.roster ?? []).map((r) => ({
      id: r.id ?? uuid(), className: r.className ?? '', seat: r.seat ?? '', studentNo: r.studentNo ?? '', name: r.name ?? '',
    })),
    subjects: (raw.subjects ?? []).map(normalizeSubject),
    currentSubjectID: opt(raw.currentSubjectID),
  };
}

/** 讀入資料檔或備份檔（iOS 版、網頁版都可以；也看得懂沒有學期的舊版格式）。格式不對會丟出錯誤。 */
export function decodeData(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  if (!raw || typeof raw !== 'object') throw new Error('不是實習課管理的資料檔');
  const data = emptyData();
  data.lastBackupExportAt = opt(raw.lastBackupExportAt);
  if (Array.isArray(raw.semesters)) {
    data.semesters = raw.semesters.map(normalizeSemester);
    data.currentSemesterID = opt(raw.currentSemesterID);
  } else if (Array.isArray(raw.subjects)) {
    // 舊版：沒有學期，原本的科目放進一個學期，依學生建立學生名冊
    const sem = newSemester(termName(), [], raw.subjects.map(normalizeSubject));
    sem.currentSubjectID = opt(raw.currentSubjectID) ?? sem.subjects[0]?.id ?? null;
    for (const subject of sem.subjects) linkStudentsToRoster(sem, subject);
    data.semesters = [sem];
    data.currentSemesterID = sem.id;
  } else {
    throw new Error('不是實習課管理的資料檔');
  }
  return data;
}

/** 存成 JSON（和 iOS 版的備份檔相同的格式） */
export function encodeData(data) {
  return JSON.stringify({ ...data, app: '實習課管理', schemaVersion: SCHEMA_VERSION }, null, 2);
}

export function dataSummary(data) {
  const subjects = allSubjects(data);
  return {
    semesters: data.semesters.length,
    subjects: subjects.length,
    students: data.semesters.reduce((n, s) => n + s.roster.length, 0),
    scores: subjects.reduce((n, s) => n + Object.values(s.scores).reduce((m, x) => m + Object.keys(x).length, 0), 0),
  };
}

export const cloneData = (d) => structuredClone(d);
export { startOfDay };
