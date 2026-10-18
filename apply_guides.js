const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data-v2.json'), 'utf8'));
const modules = JSON.parse(fs.readFileSync(path.join(__dirname, 'guides/module_guides.json'), 'utf8'));
const vols = JSON.parse(fs.readFileSync(path.join(__dirname, 'guides/vol_guides.json'), 'utf8'));

const epByN = Object.fromEntries(data.episodes.map(e => [e.n, e]));
let moduleCount = 0, volCount = 0, missingPath = [];

for (const g of modules) {
  const m = data.modules.find(x => x.id === g.id);
  if (!m) continue;
  const guide = { ...g };
  if (Array.isArray(guide.path)) {
    guide.path = guide.path.filter(p => {
      if (!epByN[p.n]) { missingPath.push(`${g.id}:${p.n}`); return false; }
      return true;
    });
  }
  m.guide = guide;
  moduleCount++;
}

for (const g of vols) {
  const e = epByN[g.n];
  if (!e) continue;
  e.guide = {
    hook: g.hook,
    question: g.question,
    keywords: (g.keywords || []).slice(0, 3)
  };
  volCount++;
}

data.podcast.guideCount = volCount;
fs.writeFileSync(path.join(__dirname, 'data-v2.json'), JSON.stringify(data, null, 2));
console.log('guides applied', moduleCount, 'modules,', volCount, 'vols');
console.log('missing path refs', missingPath);
console.log('episodes without guide', data.episodes.filter(e => !e.guide || !e.guide.hook).map(e => e.n));
