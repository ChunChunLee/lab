// 「載入範例資料試用」用的範例科目，名字都是虛構的
import { newSubject, newStudent, newGroupSet, uuid, nowISO, sortBySeat } from './model.js';
import { addDays } from './format.js';
import { SeededGenerator, makeGroups } from './logic/groupMaker.js';

export function makeSampleSubject(now = new Date()) {
  const s = newSubject('範例：普通化學實習');
  const names = ['陳怡君', '林家豪', '黃詩涵', '張志明', '李雅婷', '王俊傑', '吳佩珊', '劉冠廷', '蔡欣怡', '楊宗翰', '許雅筑', '鄭博文'];
  s.students = names.map((name, i) => newStudent({ seat: String(i + 1), studentNo: String(11301 + i), name, note: i === 4 ? '對乳膠手套過敏' : '' }));

  const cat = s.categories; // 操作、作業、實驗報告、考試
  const item = (name, c, offset, fullScore) => ({ id: uuid(), name, categoryID: cat[c].id, date: addDays(now, offset).toISOString(), fullScore, createdAt: nowISO() });
  s.items = [
    item('實驗一 儀器認識', 0, -21, 100),
    item('實驗一 報告', 2, -14, 100),
    item('作業一 單位換算', 1, -10, 10),
    item('實驗二 溶液配製', 0, -7, 100),
    item('實驗二 報告', 2, -1, 100),
  ];

  const ability = [0.92, 0.78, 0.85, 0.66, 0.95, 0.55, 0.81, 0.73, 0.88, 0.69, 0.90, 0.62];
  const rng = new SeededGenerator(7);
  s.items.forEach((it, ii) => {
    const map = {};
    s.students.forEach((st, si) => {
      if (ii === 4 && si >= 9) return; // 最新的報告還有 3 人未輸入
      if (ii === 2 && si === 5) { map[st.id] = '缺'; return; }
      if (ii === 1 && si === 8) { map[st.id] = '缺'; return; }
      if (ii === 3 && si === 2) { map[st.id] = '免'; return; }
      const jitter = rng.nextInt(11) / 100 - 0.05;
      let v = Math.min(1, Math.max(0, ability[si] + jitter)) * it.fullScore;
      v = it.fullScore >= 20 ? Math.round(v) : Math.round(v * 2) / 2;
      map[st.id] = v;
    });
    s.scores[it.id] = map;
  });

  const set = newGroupSet('上學期');
  set.groups = makeGroups(sortBySeat(s.students).map((x) => x.id), { groupSize: 4, shuffle: true, randomLeaders: true, rng: new SeededGenerator(3) });
  s.groupSets = [set];
  s.activeGroupSetID = set.id;

  const ids = s.students.map((x) => x.id);
  s.duties[0].studentIDs = [...(set.groups[0]?.memberIDs ?? [])];
  s.duties[1].studentIDs = [ids[1], ids[9]];
  s.duties[3].studentIDs = [ids[5]];
  s.duties[3].note = '每次實驗後確認廢液分類';
  s.duties[5].studentIDs = [ids[0]];
  s.duties[5].note = '實習股長，負責點名和收報告';
  s.duties[6].studentIDs = [ids[6], ids[10]];
  s.duties[7].studentIDs = [ids[3]];
  return s;
}
