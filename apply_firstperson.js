const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data-v2.json'), 'utf8'));
const fpDir = path.join(__dirname, 'fp');

function frame(s){ return s; }


const files = fs.existsSync(fpDir) ? fs.readdirSync(fpDir).filter(f => /^fp\d+\.json$/.test(f)) : [];
let applied = 0;
for (const file of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(fpDir, file), 'utf8')); }
  catch (e) { console.log('bad', file, e.message); continue; }
  for (const item of arr) {
    const e = data.episodes.find(x => x.n === item.n);
    if (!e) continue;
    if (item.line) e.line = item.line;
    if (item.summary) e.summary = item.summary;
    if (Array.isArray(item.points) && item.points.length) e.points = item.points.map(frame);
    if (Array.isArray(item.analysis) && item.analysis.length) e.analysis = item.analysis.map(sec => ({ ...sec, p: (sec.p || []).map(frame) }));
    applied++;
  }
}

let modsApplied = 0;
try {
  const mods = JSON.parse(fs.readFileSync(path.join(fpDir, 'modules_fp.json'), 'utf8'));
  for (const item of mods) {
    const m = data.modules.find(x => x.id === item.id);
    if (!m) continue;
    if (item.lead) m.lead = item.lead;
    if (item.bigIdea) m.bigIdea = item.bigIdea;
    if (Array.isArray(item.sections)) m.sections = item.sections;
    if (Array.isArray(item.cases)) m.cases = item.cases.map(c => ({ ...c, text: frame(c.text || '') }));
    if (Array.isArray(item.actions)) m.actions = item.actions;
    if (Array.isArray(item.transcriptTakeaways)) m.transcriptTakeaways = item.transcriptTakeaways;
    if (m.id === 'm8') m.subtitle = '我的方法论';
    if (m.quote && m.quote.src === '主播董艺婷') m.quote.src = '我';
    modsApplied++;
  }
} catch (e) {
  console.log('modules bad', e.message);
}

fs.writeFileSync(path.join(__dirname, 'data-v2.json'), JSON.stringify(data, null, 2));
console.log('first-person applied', applied, 'episodes,', modsApplied, 'modules');
console.log('third-person host refs in narrative', data.episodes.filter(e => /董艺婷|董总/.test([e.line, e.summary, ...(e.points || []), JSON.stringify(e.analysis || [])].join(' '))).map(e => e.n));
