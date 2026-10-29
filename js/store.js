// 全部資料和所有修改都在這裡（和 iOS 版的 AppStore 相同）。修改後立刻存檔；連續輸入分數這類小修改集中 0.5 秒存一次。
import {
  emptyData, newSemester, newSubject, newStudent, newGroupSet, newGroup, newDuty, uuid, nowISO,
  termName, nextTermName, currentSemester, currentSubject, allSubjects, sortBySeat, syncSubjectStudents,
  linkStudentsToRoster, subjectCountFor, removeStudents, getScore, activeGroupSet, groupSections, nextGroupName,
  dutiesIn, dutySections, dutySectionByStudent, cloneData,
} from './model.js';
import { trimmed, startOfDay, isSameDay } from './format.js';
import { mergeIntoRoster } from './logic/rosterParser.js';
import { makeSectionedGroups } from './logic/groupMaker.js';
import { makeSampleSubject } from './sample.js';
import * as db from './db.js';

class Store {
  constructor() {
    this.data = emptyData();
    this.listeners = new Set();
    this.toast = null;
    this.saveTimer = null;
    this.dirty = false;
    this.afterSave = new Set(); // 存檔後要做的事（雲端同步）
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { for (const fn of this.listeners) fn(); }

  async load() {
    const r = await db.loadData();
    this.data = r.data;
    if (!this.data.semesters.length) {
      const sem = newSemester(termName());
      this.data.semesters = [sem];
      this.data.currentSemesterID = sem.id;
    }
    db.makeDailyBackupIfNeeded(this.data);
    this.notify();
    return r.notice;
  }

  // MARK: 存檔

  /** 修改資料。一般修改立刻存檔；batched 的集中 0.5 秒存一次 */
  update(fn, { batched = false } = {}) {
    fn(this.data);
    this.dirty = true;
    if (batched) {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveNow(), 500);
    } else {
      this.saveNow();
    }
    this.notify();
  }

  updateSemester(fn, opts) {
    const sem = currentSemester(this.data);
    if (sem) this.update(() => fn(sem), opts);
  }

  /** 修改目前學期裡的一個科目（預設是目前科目） */
  updateSubject(fn, opts, id = null) {
    const sem = currentSemester(this.data);
    const s = id ? sem?.subjects.find((x) => x.id === id) : currentSubject(sem);
    if (s) this.update(() => fn(s, sem), opts);
  }

  async saveNow() {
    clearTimeout(this.saveTimer);
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await db.saveData(this.data);
      for (const fn of this.afterSave) fn();
    } catch (e) {
      if (!this.saveErrorShown) this.showToast(`存檔失敗：${e?.message ?? e}`, true);
      this.saveErrorShown = true;
    }
  }

  showToast(text, isError = false) {
    this.toast = { text, isError, id: uuid() };
    this.notify();
    const id = this.toast.id;
    setTimeout(() => { if (this.toast?.id === id) { this.toast = null; this.notify(); } }, 2600);
  }

  // MARK: 學期

  get currentSemester() { return currentSemester(this.data); }

  addSemester(name, copyRosterFrom = null) {
    const sem = newSemester(trimmed(name) || termName());
    const source = this.data.semesters.find((s) => s.id === copyRosterFrom);
    if (source) sem.roster = source.roster.map((r) => ({ ...r, id: uuid() }));
    this.update((d) => { d.semesters.push(sem); d.currentSemesterID = sem.id; });
    return sem.id;
  }

  selectSemester(id) {
    if (this.data.currentSemesterID !== id) this.update((d) => { d.currentSemesterID = id; });
  }

  renameSemester(id, name) {
    const n = trimmed(name);
    if (n) this.update((d) => { const s = d.semesters.find((x) => x.id === id); if (s) s.name = n; });
  }

  /** 刪除學期（至少要留一個） */
  deleteSemester(id) {
    if (this.data.semesters.length < 2) return;
    this.update((d) => {
      d.semesters = d.semesters.filter((s) => s.id !== id);
      if (d.currentSemesterID === id) d.currentSemesterID = d.semesters.at(-1)?.id ?? null;
    });
  }

  /** 建議的新學期名稱：最後一個學期的下一學期，否則依今天日期 */
  get suggestedSemesterName() {
    const existing = new Set(this.data.semesters.map((s) => s.name));
    const next = nextTermName(this.data.semesters.at(-1)?.name ?? '');
    if (next && !existing.has(next)) return next;
    const today = termName();
    return existing.has(today) ? '新學期' : today;
  }

  // MARK: 學生名冊（全學期共用）

  get roster() { return this.currentSemester?.roster ?? []; }

  addRosterStudent(student) {
    this.updateSemester((sem) => { sem.roster.push(student); });
  }

  /** 修改學生名冊的學生，並同步到各科目；科目裡的座號和名冊原本一樣的話也跟著改 */
  updateRosterStudent(student) {
    this.updateSemester((sem) => {
      const i = sem.roster.findIndex((r) => r.id === student.id);
      if (i < 0) return;
      const oldSeat = sem.roster[i].seat;
      sem.roster[i] = { ...student };
      for (const s of sem.subjects) {
        for (const st of s.students) if (st.rosterID === student.id && st.seat === oldSeat) st.seat = student.seat;
      }
      syncSubjectStudents(sem);
    });
  }

  /** 從學生名冊刪除，也會從這學期所有科目的名冊移除（含成績） */
  deleteRosterStudents(ids) {
    if (!ids.size) return;
    this.updateSemester((sem) => {
      sem.roster = sem.roster.filter((r) => !ids.has(r.id));
      for (const s of sem.subjects) removeStudents(s, new Set(s.students.filter((st) => st.rosterID && ids.has(st.rosterID)).map((st) => st.id)));
    });
  }

  renameClass(old, name) {
    const n = trimmed(name);
    if (n === old) return;
    this.updateSemester((sem) => {
      for (const r of sem.roster) if (r.className === old) r.className = n;
      syncSubjectStudents(sem);
    });
  }

  deleteClass(name) {
    this.deleteRosterStudents(new Set(this.roster.filter((r) => r.className === name).map((r) => r.id)));
  }

  importRoster(incoming, defaultClass) {
    let result;
    this.updateSemester((sem) => {
      result = mergeIntoRoster(incoming, defaultClass, sem.roster);
      syncSubjectStudents(sem);
    });
    return result;
  }

  nextRosterSeat(className) {
    return String(Math.max(0, ...this.roster.filter((r) => r.className === className).map((r) => Number(r.seat)).filter(Number.isInteger)) + 1);
  }

  subjectCountForRosterStudent(id) {
    return this.currentSemester ? subjectCountFor(this.currentSemester, id) : 0;
  }

  // MARK: 科目

  get subjects() { return this.currentSemester?.subjects ?? []; }
  get currentSubject() { return currentSubject(this.currentSemester); }

  /** 從學生名冊轉成科目的學生：座號用名冊的，沒有就接在最後 */
  static subjectStudents(picked, existing) {
    let next = Math.max(0, ...existing.map((s) => Number(s.seat)).filter(Number.isInteger)) + 1;
    return picked.map((r) => newStudent({
      seat: r.seat || String(next++), studentNo: r.studentNo, name: r.name, className: r.className, rosterID: r.id,
    }));
  }

  /** 新增科目，並把選到的班級從學生名冊匯入 */
  addSubject(name, classes = []) {
    const s = newSubject(trimmed(name) || '新科目');
    s.students = Store.subjectStudents(sortBySeat(this.roster.filter((r) => classes.includes(r.className))), []);
    this.updateSemester((sem) => { sem.subjects.push(s); sem.currentSubjectID = s.id; });
    return s.id;
  }

  selectSubject(id) {
    if (this.currentSubject?.id !== id) this.updateSemester((sem) => { sem.currentSubjectID = id; });
  }

  renameSubject(id, name) {
    const n = trimmed(name);
    if (n) this.updateSubject((s) => { s.name = n; }, undefined, id);
  }

  deleteSubject(id) {
    this.updateSemester((sem) => {
      sem.subjects = sem.subjects.filter((s) => s.id !== id);
      if (sem.currentSubjectID === id) sem.currentSubjectID = sem.subjects[0]?.id ?? null;
    });
  }

  moveSubject(id, delta) {
    this.updateSemester((sem) => {
      const i = sem.subjects.findIndex((s) => s.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= sem.subjects.length) return;
      [sem.subjects[i], sem.subjects[j]] = [sem.subjects[j], sem.subjects[i]];
    });
  }

  loadSample() {
    const s = makeSampleSubject();
    for (const st of s.students) st.className = '範例班';
    this.updateSemester((sem) => {
      sem.subjects.push(s);
      sem.currentSubjectID = s.id;
      linkStudentsToRoster(sem, s);
    });
  }

  // MARK: 科目的名冊

  /** 把學生名冊的學生加進目前科目（已經在的跳過），回傳加了幾位 */
  addStudentsFromRoster(ids) {
    const subject = this.currentSubject;
    if (!subject) return 0;
    const existing = new Set(subject.students.map((s) => s.rosterID).filter(Boolean));
    const picked = sortBySeat(this.roster.filter((r) => ids.has(r.id) && !existing.has(r.id)));
    if (!picked.length) return 0;
    this.updateSubject((s) => { s.students.push(...Store.subjectStudents(picked, s.students)); });
    return picked.length;
  }

  updateStudent(student) {
    this.updateSubject((s) => { const i = s.students.findIndex((x) => x.id === student.id); if (i >= 0) s.students[i] = { ...student }; });
  }

  /** 從目前科目移除（學生名冊裡的資料不動） */
  deleteStudents(ids) { this.updateSubject((s) => removeStudents(s, ids)); }
  clearRoster() { this.updateSubject((s) => removeStudents(s, new Set(s.students.map((x) => x.id)))); }

  // MARK: 成績類別與項目

  addCategory(name, weight = 0) {
    let id = null;
    this.updateSubject((s) => {
      const c = { id: uuid(), name: trimmed(name) || '新類別', weight, colorIndex: Math.max(-1, ...s.categories.map((x) => x.colorIndex)) + 1 };
      id = c.id;
      s.categories.push(c);
    });
    return id;
  }

  /** 從配分設定畫面整批套用；被刪掉的類別，其項目和分數一起刪除 */
  applyCategories(categories) {
    this.updateSubject((s) => {
      const keep = new Set(categories.map((c) => c.id));
      for (const it of s.items) if (!keep.has(it.categoryID)) delete s.scores[it.id];
      s.items = s.items.filter((it) => keep.has(it.categoryID));
      s.categories = categories.map((c) => ({ ...c }));
    });
  }

  addItem(item) { this.updateSubject((s) => { s.items.push(item); }); }
  updateItem(item) { this.updateSubject((s) => { const i = s.items.findIndex((x) => x.id === item.id); if (i >= 0) s.items[i] = { ...item }; }); }
  deleteItem(id) { this.updateSubject((s) => { s.items = s.items.filter((x) => x.id !== id); delete s.scores[id]; }); }

  setScore(itemID, studentID, value) {
    const subject = this.currentSubject;
    if (!subject || getScore(subject, itemID, studentID) === value) return;
    this.setScores([{ itemID, studentID, value }]);
  }

  /** value 是數字、「缺」、「免」或 undefined（清除） */
  setScores(changes) {
    if (!changes.length) return;
    this.updateSubject((s) => {
      for (const c of changes) {
        const map = s.scores[c.itemID] ?? (s.scores[c.itemID] = {});
        if (c.value === undefined || c.value === null) delete map[c.studentID]; else map[c.studentID] = c.value;
      }
    }, { batched: true });
  }

  /** 把某個項目裡還沒輸入的格子全部設成缺交，回傳設定了幾格 */
  markBlanksMissing(itemID) {
    const s = this.currentSubject;
    if (!s) return 0;
    const blanks = s.students.filter((st) => getScore(s, itemID, st.id) === undefined);
    this.setScores(blanks.map((st) => ({ itemID, studentID: st.id, value: '缺' })));
    return blanks.length;
  }

  updateGradeSettings(settings) { this.updateSubject((s) => { s.gradeSettings = { ...settings }; }); }

  // MARK: 分組

  addGroupSet(name) {
    const set = newGroupSet(trimmed(name) || '新分組方案');
    this.updateSubject((s) => {
      s.groupSets.push(set);
      if (!s.activeGroupSetID || !s.groupSets.some((g) => g.id === s.activeGroupSetID)) s.activeGroupSetID = set.id;
    });
    return set.id;
  }

  updateGroupSet(setID, fn, opts) {
    this.updateSubject((s) => { const set = s.groupSets.find((g) => g.id === setID); if (set) fn(set, s); }, opts);
  }

  renameGroupSet(setID, name) { const n = trimmed(name); if (n) this.updateGroupSet(setID, (set) => { set.name = n; }); }

  duplicateGroupSet(setID) {
    const original = this.currentSubject?.groupSets.find((g) => g.id === setID);
    if (!original) return null;
    const copy = { ...structuredClone(original), id: uuid(), name: `${original.name}（複製）`, createdAt: nowISO() };
    copy.groups = copy.groups.map((g) => ({ ...g, id: uuid() }));
    this.updateSubject((s) => { s.groupSets.push(copy); });
    return copy.id;
  }

  deleteGroupSet(setID) {
    this.updateSubject((s) => {
      s.groupSets = s.groupSets.filter((g) => g.id !== setID);
      if (s.activeGroupSetID === setID) s.activeGroupSetID = s.groupSets[0]?.id ?? null;
    });
  }

  setActiveGroupSet(setID) { this.updateSubject((s) => { s.activeGroupSetID = setID; }); }
  setGroupSize(size, setID) { this.updateGroupSet(setID, (set) => { set.groupSize = Math.max(1, size); }); }
  setSectionCount(count, setID) { this.updateGroupSet(setID, (set) => { set.sectionCount = Math.max(1, count); }); }

  /** 重新分組：隨機（shuffle）或依座號順序 */
  regroup(setID, { shuffle, randomLeaders }) {
    const subject = this.currentSubject;
    const set = subject?.groupSets.find((g) => g.id === setID);
    if (!set) return;
    const groups = makeSectionedGroups(sortBySeat(subject.students).map((s) => s.id),
      { sections: set.sectionCount ?? 1, groupSize: set.groupSize, shuffle, randomLeaders });
    this.updateGroupSet(setID, (g) => { g.groups = groups; });
  }

  /** 大組改名：這個大組裡的每一組都跟著改；是目前使用的方案的話，打掃工作和檢查表的大組也跟著改 */
  renameSection(old, name, setID) {
    const n = trimmed(name);
    if (!n || n === old) return;
    this.updateSubject((s) => {
      const isActive = activeGroupSet(s)?.id === setID;
      const set = s.groupSets.find((g) => g.id === setID);
      for (const g of set?.groups ?? []) if (g.section === old) g.section = n;
      if (isActive) {
        for (const d of s.duties) if (d.section === old) d.section = n;
        for (const c of s.dutyChecks) if (c.section === old) c.section = n;
      }
    });
  }

  static insertGroup(set, group) {
    const last = set.groups.map((g) => g.section ?? null).lastIndexOf(group.section ?? null);
    set.groups.splice(last >= 0 ? last + 1 : set.groups.length, 0, group);
  }

  /** 大組內的小組如果都叫「第N組」，依順序重新編號；老師自己取的名字不動 */
  static renumber(set, sections) {
    for (const section of sections) {
      let n = 1;
      for (const g of set.groups) {
        if ((g.section ?? null) !== (section ?? null)) continue;
        if (/^第\d+組$/.test(g.name)) g.name = `第${n}組`;
        n++;
      }
    }
  }

  /** 把一個小組移到另一個大組（null 代表不分大組），排在那個大組的最後，並重新編號 */
  moveGroup(groupID, section, setID) {
    this.updateGroupSet(setID, (set) => {
      const i = set.groups.findIndex((g) => g.id === groupID);
      if (i < 0) return;
      const [g] = set.groups.splice(i, 1);
      const oldSection = g.section ?? null;
      g.section = section ?? null;
      Store.insertGroup(set, g);
      Store.renumber(set, [oldSection, g.section]);
    });
  }

  /** 把學生移到某一組；groupID 為 null 代表移到未分組 */
  moveStudent(studentID, groupID, setID) {
    this.updateGroupSet(setID, (set) => {
      for (const g of set.groups) {
        if (g.id === groupID) continue;
        g.memberIDs = g.memberIDs.filter((m) => m !== studentID);
        if (g.leaderID === studentID) g.leaderID = null;
      }
      const g = set.groups.find((x) => x.id === groupID);
      if (g && !g.memberIDs.includes(studentID)) g.memberIDs.push(studentID);
    }, { batched: true });
  }

  setLeader(studentID, groupID, setID) {
    this.updateGroupSet(setID, (set) => { const g = set.groups.find((x) => x.id === groupID); if (g) g.leaderID = studentID; });
  }

  addGroup(setID, section = null) {
    this.updateGroupSet(setID, (set) => Store.insertGroup(set, newGroup({ name: nextGroupName(set, section), section })));
  }

  renameGroup(groupID, setID, name) {
    const n = trimmed(name);
    if (n) this.updateGroupSet(setID, (set) => { const g = set.groups.find((x) => x.id === groupID); if (g) g.name = n; });
  }

  /** 刪除一組，組員會移到未分組 */
  deleteGroup(groupID, setID) { this.updateGroupSet(setID, (set) => { set.groups = set.groups.filter((g) => g.id !== groupID); }); }

  clearGroups(setID) {
    this.updateGroupSet(setID, (set) => { for (const g of set.groups) { g.memberIDs = []; g.leaderID = null; } });
  }

  /** 要用的分組方案：傳入的方案還在就用它，否則用目前使用的；一個都沒有就建立「分組」 */
  ensureGroupSet(preferred) {
    const s = this.currentSubject;
    if (preferred && s?.groupSets.some((g) => g.id === preferred)) return preferred;
    const active = s && activeGroupSet(s);
    if (active) return active.id;
    return this.addGroupSet('分組');
  }

  /** 新增（groupID 為 null）或修改一組。選進來的學生會從原本的組移過來；被移出這一組的學生變成未分組 */
  saveGroup(groupID, setID, { name, section, memberIDs, leaderID }) {
    const newID = groupID ?? uuid();
    const sec = trimmed(section ?? '') || null;
    const members = new Set(memberIDs);
    const leader = leaderID && members.has(leaderID) ? leaderID : null;
    this.updateGroupSet(setID, (set) => {
      for (const g of set.groups) {
        if (g.id === groupID) continue;
        g.memberIDs = g.memberIDs.filter((m) => !members.has(m));
        if (g.leaderID && members.has(g.leaderID)) g.leaderID = null;
      }
      const n = trimmed(name);
      const i = groupID ? set.groups.findIndex((g) => g.id === groupID) : -1;
      if (i >= 0) {
        const g = set.groups[i];
        if (n) g.name = n;
        g.memberIDs = [...memberIDs];
        g.leaderID = leader;
        if ((g.section ?? null) !== sec) {
          set.groups.splice(i, 1);
          g.section = sec;
          Store.insertGroup(set, g);
        }
      } else {
        Store.insertGroup(set, newGroup({ id: newID, name: n || nextGroupName(set, sec), leaderID: leader, memberIDs: [...memberIDs], section: sec }));
      }
    });
    return newID;
  }

  /** 套用從 Excel 讀到的分組。target：{ replace: setID } 或 { newSet: 名稱 }（設為目前使用）。回傳方案 ID */
  applyGroupImport(plan, target) {
    const groups = plan.groups.map((g) => newGroup({ name: g.name, leaderID: g.leaderID, memberIDs: [...g.memberIDs], section: g.section }));
    const sectionCount = Math.max(1, plan.sections.length);
    if (target.replace) {
      this.updateGroupSet(target.replace, (set) => { set.groups = groups; set.sectionCount = sectionCount; });
      return target.replace;
    }
    const set = newGroupSet(trimmed(target.newSet) || '匯入的分組');
    set.groups = groups;
    set.sectionCount = sectionCount;
    this.updateSubject((s) => { s.groupSets.push(set); s.activeGroupSetID = set.id; });
    return set.id;
  }

  // MARK: 打掃工作

  addDuty(duty) { this.updateSubject((s) => { s.duties.push(duty); }); }
  updateDuty(duty) { this.updateSubject((s) => { const i = s.duties.findIndex((d) => d.id === duty.id); if (i >= 0) s.duties[i] = { ...duty }; }); }
  deleteDuty(id) { this.updateSubject((s) => { s.duties = s.duties.filter((d) => d.id !== id); }); }

  /** 調整某個大組裡的順序 */
  moveDuty(id, delta, section) {
    this.updateSubject((s) => {
      const list = dutiesIn(s, section);
      const i = list.findIndex((d) => d.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      let k = 0;
      s.duties = s.duties.map((d) => ((d.section ?? null) === (section ?? null) ? list[k++] : d));
    });
  }

  /** 一次新增好幾項打掃工作到這些大組；同一個大組裡已經有的名稱略過。回傳新增了幾項 */
  addDuties(jobs, sections) {
    let added = 0;
    this.updateSubject((s) => {
      for (const section of sections) {
        const existing = new Set(dutiesIn(s, section).map((d) => d.name));
        for (const job of jobs) {
          if (existing.has(job.name)) continue;
          s.duties.push(newDuty(job.name, job.note, [], section));
          added++;
        }
      }
    });
    return added;
  }

  /** 把「不分大組」的打掃工作分到每個大組各一份：已指派的學生跟著自己的大組 */
  distributeLooseDuties() {
    const subject = this.currentSubject;
    if (!subject) return;
    const sections = dutySections(subject);
    if (!sections.length) return;
    const sectionOf = dutySectionByStudent(subject);
    this.updateSubject((s) => {
      const loose = dutiesIn(s, null);
      s.duties = s.duties.filter((d) => d.section);
      for (const section of sections) {
        for (const d of loose) {
          const ids = d.studentIDs.filter((id) => sectionOf.get(id) === section);
          const existing = s.duties.find((x) => x.section === section && x.name === d.name);
          if (existing) { for (const id of ids) if (!existing.studentIDs.includes(id)) existing.studentIDs.push(id); }
          else s.duties.push(newDuty(d.name, d.note, ids, section));
        }
      }
    });
  }

  /** 把另一個大組的打掃工作（名稱和說明，不含學生）複製過來；已經有的略過 */
  copyDuties(from, to) {
    const subject = this.currentSubject;
    if (!subject) return 0;
    return this.addDuties(dutiesIn(subject, from).map((d) => ({ name: d.name, note: d.note })), [to]);
  }

  /** 套用 Excel 匯入的打掃工作。replace：清掉原本所有大組的打掃工作；否則同名的合併學生 */
  applyDutyImport(plan, replace) {
    this.updateSubject((s) => {
      if (replace) s.duties = [];
      for (const item of plan.items) {
        const d = s.duties.find((x) => (x.section ?? null) === (item.section ?? null) && x.name === item.name);
        if (d) {
          for (const id of item.studentIDs) if (!d.studentIDs.includes(id)) d.studentIDs.push(id);
          if (!trimmed(d.note)) d.note = item.note;
        } else {
          s.duties.push(newDuty(item.name, item.note, [...item.studentIDs], item.section));
        }
      }
    });
  }

  // MARK: 打掃檢查表

  /** 修改某一天、某個大組的檢查；沒有任何勾選也沒有備註的那一天會移除 */
  updateDutyCheck(date, section, fn, opts) {
    const day = startOfDay(date);
    this.updateSubject((s) => {
      let i = s.dutyChecks.findIndex((c) => (c.section ?? null) === (section ?? null) && isSameDay(c.date, day));
      if (i < 0) {
        s.dutyChecks.push({ id: uuid(), date: day.toISOString(), section: section ?? null, results: {}, note: '' });
        i = s.dutyChecks.length - 1;
      }
      fn(s.dutyChecks[i]);
      const c = s.dutyChecks[i];
      if (!Object.keys(c.results).length && !trimmed(c.note)) s.dutyChecks.splice(i, 1);
    }, opts);
  }

  /** done：true 完成、false 沒做好、null 取消 */
  setDutyCheck(dutyID, done, date, section) {
    this.updateDutyCheck(date, section, (c) => { if (done === null) delete c.results[dutyID]; else c.results[dutyID] = done; });
  }

  /** 還沒檢查的都設成完成（已經標「沒做好」的不動） */
  checkRemainingDuties(dutyIDs, date, section) {
    this.updateDutyCheck(date, section, (c) => { for (const id of dutyIDs) if (c.results[id] === undefined) c.results[id] = true; });
  }

  setDutyCheckNote(note, date, section) {
    this.updateDutyCheck(date, section, (c) => { c.note = note; }, { batched: true });
  }

  deleteDutyCheckDay(id) { this.updateSubject((s) => { s.dutyChecks = s.dutyChecks.filter((c) => c.id !== id); }); }

  // MARK: 備份

  markBackupExported() { this.update((d) => { d.lastBackupExportAt = nowISO(); }); }

  /** 換成雲端同步下來的資料。目前選的學期、科目和上次匯出備份的時間是這台裝置自己的，保留下來 */
  applySynced(incoming) {
    const keepSemester = this.data.currentSemesterID;
    const keepSubject = new Map(this.data.semesters.map((s) => [s.id, s.currentSubjectID]));
    const lastExport = this.data.lastBackupExportAt;
    this.update((d) => {
      Object.assign(d, cloneData(incoming));
      d.lastBackupExportAt = lastExport;
      if (!d.semesters.length) d.semesters = [newSemester(termName())];
      if (d.semesters.some((s) => s.id === keepSemester)) d.currentSemesterID = keepSemester;
      if (!d.semesters.some((s) => s.id === d.currentSemesterID)) d.currentSemesterID = d.semesters.at(-1).id;
      for (const sem of d.semesters) {
        const id = keepSubject.get(sem.id);
        if (id && sem.subjects.some((s) => s.id === id)) sem.currentSubjectID = id;
      }
    });
  }

  /** mode：'replaceAll' 取代全部資料、'appendSemesters' 加入為新學期 */
  async restore(incoming, mode) {
    await db.saveBeforeRestoreCopy(this.data);
    if (mode === 'replaceAll') {
      const lastExport = this.data.lastBackupExportAt;
      this.update((d) => {
        Object.assign(d, cloneData(incoming));
        d.lastBackupExportAt = lastExport;
        if (!d.semesters.length) d.semesters = [newSemester(termName())];
        if (!d.semesters.some((s) => s.id === d.currentSemesterID)) d.currentSemesterID = d.semesters.at(-1).id;
      });
    } else {
      this.update((d) => {
        const names = new Set(d.semesters.map((s) => s.name));
        let first = null;
        for (const sem of cloneData(incoming).semesters) {
          sem.id = uuid();
          if (names.has(sem.name)) sem.name += '（匯入）';
          first ??= sem.id;
          d.semesters.push(sem);
        }
        if (first) d.currentSemesterID = first;
      });
    }
  }

  get allSubjects() { return allSubjects(this.data); }
  get groupSectionsOfActive() { const s = this.currentSubject; return s ? groupSections(activeGroupSet(s)) : []; }
}

export const store = new Store();
