// 成績計算（和 iOS 版相同的規則）
import { round } from '../format.js';
import { sortedStudents, sortedItems, getScore } from '../model.js';

/** 一格分數計入類別成績的方式：缺交算 0 分，免計不算，空白依設定 */
function contribution(value, full, blankAsZero) {
  if (!(full > 0)) return null;
  if (typeof value === 'number') return [value, full];
  if (value === '缺') return [0, full];
  if (value === '免') return null;
  return blankAsZero ? [0, full] : null;
}

export function categoryScore(items, studentID, subject) {
  const settings = subject.gradeSettings;
  const parts = items.map((it) => contribution(getScore(subject, it.id, studentID), it.fullScore, settings.blankAsZero)).filter(Boolean);
  if (!parts.length) return null;
  if (settings.categoryMode === 'totalPoints') {
    const points = parts.reduce((t, p) => t + p[0], 0);
    const full = parts.reduce((t, p) => t + p[1], 0);
    return full > 0 ? (points / full) * 100 : null;
  }
  return parts.reduce((t, p) => t + (p[0] / p[1]) * 100, 0) / parts.length;
}

/** 總成績＝Σ(類別成績 × 配分) ÷ 有成績的類別的配分總和 */
export function totalScore(categoryScores, categories) {
  let sum = 0, weights = 0;
  for (const c of categories) {
    if (!(c.weight > 0)) continue;
    const s = categoryScores.get(c.id);
    if (s !== undefined && s !== null) { sum += s * c.weight; weights += c.weight; }
  }
  return weights > 0 ? sum / weights : null;
}

export function valueStats(values) {
  if (!values.length) return { average: null, maximum: null, minimum: null, count: 0 };
  return {
    average: values.reduce((a, b) => a + b, 0) / values.length,
    maximum: Math.max(...values), minimum: Math.min(...values), count: values.length,
  };
}

/** 一個成績項目的統計。平均、最高、最低只算有輸入的分數（不含缺交） */
export function itemStats(item, students, subject) {
  const st = { entered: 0, missing: 0, excused: 0, blank: 0 };
  const values = [];
  const map = subject.scores[item.id] ?? {};
  for (const s of students) {
    const v = map[s.id];
    if (typeof v === 'number') { values.push(v); st.entered++; }
    else if (v === '缺') st.missing++;
    else if (v === '免') st.excused++;
    else st.blank++;
  }
  const v = valueStats(values);
  return { ...st, average: v.average, maximum: v.maximum, minimum: v.minimum, recorded: st.entered + st.missing + st.excused };
}

/** 一個科目算好的成績：每位學生的類別成績、總成績，以及各欄統計 */
export function gradeReport(subject) {
  const students = sortedStudents(subject);
  const items = sortedItems(subject);
  const settings = subject.gradeSettings;
  const byCategory = new Map();
  for (const it of items) {
    if (!byCategory.has(it.categoryID)) byCategory.set(it.categoryID, []);
    byCategory.get(it.categoryID).push(it);
  }
  const categoriesInUse = subject.categories.filter((c) => byCategory.has(c.id));

  const results = new Map();
  for (const s of students) {
    const cats = new Map();
    for (const c of categoriesInUse) {
      const v = categoryScore(byCategory.get(c.id), s.id, subject);
      if (v !== null) cats.set(c.id, v);
    }
    results.set(s.id, { categoryScores: cats, total: totalScore(cats, subject.categories) });
  }

  const stats = new Map(items.map((it) => [it.id, itemStats(it, students, subject)]));
  const categoryStats = new Map(categoriesInUse.map((c) => [c.id,
    valueStats(students.map((s) => results.get(s.id).categoryScores.get(c.id)).filter((v) => v !== undefined).map((v) => round(v, 1)))]));
  const totalStats = valueStats(students.map((s) => results.get(s.id).total).filter((v) => v !== null).map((v) => round(v, settings.totalDecimals)));

  return {
    subject, students, items, categoriesInUse, results, itemStats: stats, categoryStats, totalStats, settings,
    /** 顯示用的類別成績（小數一位） */
    categoryScore(studentID, categoryID) {
      const v = results.get(studentID)?.categoryScores.get(categoryID);
      return v === undefined ? null : round(v, 1);
    },
    /** 顯示用的總成績（依設定的小數位數） */
    total(studentID) {
      const v = results.get(studentID)?.total;
      return v === null || v === undefined ? null : round(v, settings.totalDecimals);
    },
    isFailing(value) { return value !== null && value !== undefined && value < settings.passLine; },
    isFailingPoints(points, full) { return full > 0 && round((points / full) * 100, 2) < settings.passLine; },
  };
}

export const CATEGORY_MODES = {
  averagePercent: {
    title: '各項目換算百分制後平均',
    detail: '每個項目先換算成 100 分制再平均，每個項目一樣重要。例如 8/10 和 90/100 平均是 85。',
  },
  totalPoints: {
    title: '依滿分加總',
    detail: '得分總和 ÷ 滿分總和，滿分高的項目比重較大。例如 8/10 和 90/100 是 98/110 = 89.1。',
  },
};
