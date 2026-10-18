const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data-v2.json'), 'utf8'));
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'guides/dongliao.json'), 'utf8'));
const byN = Object.fromEntries(data.episodes.map(e => [e.n, e]));
let applied = 0;
const missingQuote = [];

for (const g of rows) {
  const e = byN[g.n];
  if (!e) continue;
  const q = (e.quotes || []).find(x => x.t === g.quoteT) || (e.quotes || [])[0];
  if (!q) { missingQuote.push(g.n); continue; }
  e.dongliao = {
    title: g.title,
    quote: q.text,
    t: q.t,
    context: g.context,
    critique: g.critique,
    insight: g.insight
  };
  applied++;
}

data.podcast.dongliaoCount = applied;
fs.writeFileSync(path.join(__dirname, 'data-v2.json'), JSON.stringify(data, null, 2));
console.log('dongliao applied', applied, 'missing quotes', missingQuote);
console.log('episodes without dongliao', data.episodes.filter(e => !e.dongliao || !e.dongliao.quote).map(e => e.n));
