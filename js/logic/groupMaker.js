// 隨機分組（和 iOS 版相同的規則）
import { newGroup, sectionName } from '../model.js';

/** 固定種子的亂數（SplitMix64，和 iOS 版的範例資料一樣） */
export class SeededGenerator {
  constructor(seed) { this.state = BigInt(seed); }
  next() {
    const M = (1n << 64n) - 1n;
    this.state = (this.state + 0x9E3779B97F4A7C15n) & M;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & M;
    z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & M;
    return z ^ (z >> 31n);
  }
  /** 0..<n 的整數 */
  nextInt(n) { return Number(this.next() % BigInt(n)); }
}

export const systemRandom = { nextInt: (n) => Math.floor(Math.random() * n) };

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 分組：每組人數是上限，平均分配，各組人數最多差 1 人。
 * 例如 41 人、每組 4 人 → 11 組（8 組 4 人、3 組 3 人）。
 */
export function makeGroups(studentIDs, { groupSize, shuffle: doShuffle, randomLeaders, rng = systemRandom }) {
  const n = studentIDs.length;
  if (!n) return [];
  const size = Math.max(1, groupSize);
  const groupCount = Math.ceil(n / size);
  const ids = doShuffle ? shuffle(studentIDs, rng) : [...studentIDs];
  const base = Math.floor(n / groupCount);
  const extra = n % groupCount;
  const groups = [];
  let index = 0;
  for (let g = 0; g < groupCount; g++) {
    const count = base + (g < extra ? 1 : 0);
    const members = ids.slice(index, index + count);
    index += count;
    const group = newGroup({ name: `第${g + 1}組`, memberIDs: members });
    if (randomLeaders && members.length) group.leaderID = members[rng.nextInt(members.length)];
    groups.push(group);
  }
  return groups;
}

/** 先把學生平均分成幾個大組，再在每個大組裡分小組；小組編號在每個大組內從第1組開始 */
export function makeSectionedGroups(studentIDs, { sections, groupSize, shuffle: doShuffle, randomLeaders, rng = systemRandom }) {
  const count = Math.max(1, Math.min(sections, studentIDs.length));
  if (count <= 1) return makeGroups(studentIDs, { groupSize, shuffle: doShuffle, randomLeaders, rng });
  const ids = doShuffle ? shuffle(studentIDs, rng) : [...studentIDs];
  const base = Math.floor(ids.length / count);
  const extra = ids.length % count;
  const result = [];
  let index = 0;
  for (let s = 0; s < count; s++) {
    const size = base + (s < extra ? 1 : 0);
    const chunk = ids.slice(index, index + size);
    index += size;
    const groups = makeGroups(chunk, { groupSize, shuffle: false, randomLeaders, rng });
    for (const g of groups) g.section = sectionName(s);
    result.push(...groups);
  }
  return result;
}
