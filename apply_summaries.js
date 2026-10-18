const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data-v2.json'), 'utf8'));
const dir = path.join(__dirname, 'summaries');

function clean(t) {
  return String(t || '')
    .replace(/[嗯呃哦啊诶唉哎]/g, '')
    .replace(/董依婷/g, '董艺婷')
    .replace(/f\s*o\s*f|forf|负户/gi, 'FOF')
    .replace(/e\s*t\s*f/gi, 'ETF')
    .replace(/c\s*t\s*a/gi, 'CTA')
    .replace(/g\s*d\s*p/gi, 'GDP')
    .replace(/c\s*p\s*i/gi, 'CPI')
    .replace(/p\s*p\s*i/gi, 'PPI')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/^[，。；、\s]+/, '')
    .replace(/\s+/g, '')
    .trim();
}

const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^batch.*\.json$/.test(f)) : [];
let applied = 0;
for (const file of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); }
  catch (e) { console.log('bad', file, e.message); continue; }
  for (const item of arr) {
    const e = data.episodes.find(x => x.n === item.n);
    if (!e) continue;
    if (item.line) e.line = clean(item.line);
    if (item.summary) e.summary = clean(item.summary);
    if (Array.isArray(item.keyPoints) && item.keyPoints.length) {
      if (!Array.isArray(e.shownotePoints) || !e.shownotePoints.length) e.shownotePoints = e.points;
      e.points = item.keyPoints.map(clean).filter(Boolean);
    }
    if (Array.isArray(item.quotes)) {
      e.quotes = item.quotes
        .map(q => ({ t: q.t, text: clean(q.text) }))
        .filter(q => q.t && q.text.length >= 12);
    }
    if (Array.isArray(item.analysis) && item.analysis.length) {
      e.analysis = item.analysis.map(s => ({
        h: clean(s.h),
        p: (s.p || []).map(clean).filter(Boolean)
      }));
    }
    if (item.case) e.case = clean(item.case);
    if (Array.isArray(item.keywords)) e.keywords = item.keywords.map(clean).filter(Boolean);
    if (item.guide && item.guide.hook) {
      e.guide = {
        hook: clean(item.guide.hook),
        question: clean(item.guide.question || ''),
        keywords: (item.guide.keywords || e.keywords || []).map(clean).filter(Boolean).slice(0, 3)
      };
    }
    applied++;
  }
}

// Every episode gets an original-text-derived fallback: 3 key sentences from its transcript.
for (const e of data.episodes) {
  if (Array.isArray(e.analysis) && e.analysis.length) {
    e.pointsSource = 'agent';
    e.summarySource = 'agent';
  } else if (e.quotes && e.quotes.length && e.points && e.points.length) {
    e.pointsSource = 'agent-brief';
    e.summarySource = 'agent';
  } else {
    if (e.points && e.points.length && (!Array.isArray(e.shownotePoints) || !e.shownotePoints.length)) e.shownotePoints = e.points;
    const ks = (e.keyChunks || []).slice(0, 3).map(c => c.text);
    if (ks.length) e.points = ks;
    e.pointsSource = 'transcript';
    e.summary = e.summary || e.line;
    e.summarySource = e.summarySource || 'shownotes';
  }
}

function tsec(t){ const p=String(t||'').split(':').map(Number); return p.length===3?p[0]*3600+p[1]*60+p[2]:(p.length===2?p[0]*60+p[1]:0); }

// Prefer curated quotes for the "原文精读" block; fill with machine excerpts when needed.
for (const e of data.episodes) {
  const quotes = e.quotes || [];
  const ks = e.keyChunks || [];
  const extra = ks.filter(k => !quotes.some(q => q.text.slice(0,12) === k.text.slice(0,12)));
  if (quotes.length) {
    const all = quotes.map(q => ({ ...q, start: tsec(q.t) })).concat(extra);
    all.sort((a,b) => (a.start||0) - (b.start||0));
    e.excerpts = all.slice(0, 6);
  } else {
    e.excerpts = ks;
  }
}

let takeaways = {};
try { takeaways = JSON.parse(fs.readFileSync(path.join(__dirname, 'module_takeaways.json'), 'utf8')); } catch (e) {}
for (const m of data.modules) { if (takeaways[m.id]) m.transcriptTakeaways = takeaways[m.id]; }

let curatedModuleQuotes = {};
try { curatedModuleQuotes = JSON.parse(fs.readFileSync(path.join(__dirname, 'module_quotes.json'), 'utf8')); } catch (e) {}

// Module-level quotes: curated map first, then one per episode.
for (const m of data.modules) {
  const curated = curatedModuleQuotes[m.id];
  if (curated && curated.length) {
    const picks = [];
    for (const ref of curated) {
      const e = data.episodes.find(x => x.n === ref.n);
      if (!e) continue;
      const q = (e.quotes || []).find(x => x.t === ref.t) || (e.keyChunks || []).find(x => x.t === ref.t);
      if (q) picks.push({ n: e.n, label: e.label, t: q.t, text: q.text });
    }
    if (picks.length >= 3) { m.quotes = picks; continue; }
  }
  const eps = data.episodes
    .filter(e => (e.mods || []).includes(m.id))
    .sort((a, b) => (b.core ? 1 : 0) - (a.core ? 1 : 0));
  const picks = [];
  for (const e of eps) {
    const q = (e.quotes && (e.quotes.find(x => x.t !== '00:00' && x.text.length >= 30) || e.quotes[0])) || (e.keyChunks && (e.keyChunks.find(x => x.t !== '00:00') || e.keyChunks[0]));
    if (!q) continue;
    if (picks.some(x => x.n === e.n)) continue;
    picks.push({ n: e.n, label: e.label, t: q.t, text: q.text });
    if (picks.length >= 4) break;
  }
  m.quotes = picks;
}

fs.writeFileSync(path.join(__dirname, 'data-v2.json'), JSON.stringify(data, null, 2));
console.log('applied summaries', applied, 'files', files.join(','));
console.log('episodes with analysis', data.episodes.filter(e => e.analysis && e.analysis.length).length);
console.log('episodes with quotes', data.episodes.filter(e => e.quotes && e.quotes.length).length);
console.log('module quotes', data.modules.map(m => `${m.id}:${m.quotes.length}`).join(' '));
