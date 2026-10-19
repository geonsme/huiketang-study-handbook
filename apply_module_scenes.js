const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data-v2.json');
const scenePath = path.join(__dirname, 'module_scenes.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const scenes = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
const epNs = new Set((data.episodes || []).map(e => e.n));

let changed = 0;
for (const m of data.modules || []) {
  const next = scenes[m.id];
  if (!next) throw new Error(`module_scenes.json 缺少 ${m.id}`);
  if ((next.thread || []).length !== 3) throw new Error(`${m.id}: thread 必须是 3 项`);
  if ((next.scenes || []).length !== 3) throw new Error(`${m.id}: scenes 必须是 3 个回合`);
  if ((next.cases || []).length !== 3) throw new Error(`${m.id}: cases 必须是 3 个现场`);
  if ((next.takes || []).length !== 3) throw new Error(`${m.id}: takes 必须是 3 条`);
  const d = next.deduction || {};
  for (const k of ['premise', 'turn', 'landing']) {
    if (!d[k] || !d[k].k || !d[k].h || !d[k].p) throw new Error(`${m.id}: deduction.${k} 不完整`);
  }
  if (!d.boundary) throw new Error(`${m.id}: deduction.boundary 缺失`);
  for (const s of next.scenes) {
    if (!epNs.has(s.ep)) throw new Error(`${m.id}: scene 引用了不存在的 ep${s.ep}`);
    if (!s.q || !s.a || !s.src || !s.t || !s.note) throw new Error(`${m.id}: scene 字段不完整`);
  }
  for (const c of next.cases) {
    if (!epNs.has(c.ep)) throw new Error(`${m.id}: case 引用了不存在的 ep${c.ep}`);
  }
  m.thread = next.thread;
  m.scenes = next.scenes;
  m.deduction = next.deduction;
  m.sceneCases = next.cases;
  m.takes = next.takes;
  changed++;
}

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
console.log(`applied module scenes: ${changed} modules, ${data.episodes.length} episodes`);
