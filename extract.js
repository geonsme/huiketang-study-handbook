const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'feed.json'), 'utf8'));

const stripHtml = (html) => html
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<\/li>/gi, '\n')
  .replace(/<li[^>]*>/gi, '• ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const tsRe = /(?:^|\n)\s*(?:[•*\-]\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s*[｜|:：]\s*([^\n]+)/g;

const out = data.map(e => {
  const raw = stripHtml(e.shownotes);
  const cutIdx = raw.indexOf('我们是谁');
  let body = cutIdx > 200 ? raw.slice(0, cutIdx) : raw;
  // remove common footer and link
  body = body.replace(/在小宇宙查看该单集文稿[\s\S]*$/, '').trim();
  const chapters = [];
  let m;
  tsRe.lastIndex = 0;
  while ((m = tsRe.exec(body))) {
    let text = m[2].trim();
    chapters.push({ time: m[1], text });
  }
  // intro = text before first timestamp
  let intro = body;
  const first = chapters.length ? body.search(new RegExp(chapters[0].time.replace(/:/g, ':'))) : -1;
  if (chapters.length && first > 0) intro = body.slice(0, first).trim();
  // remove header boilerplate / bookkeeping
  intro = intro.split('\n').filter(l => !/^[🌟🛋️⏰📚🎧✨🧭🕙📖🔍📮]/.test(l.trim()) || l.trim().length > 40).join('\n').trim();
  const numMatch = e.title.match(/(?:Vol\.|V)(\d+)/i);
  return {
    index: e.index,
    vol: numMatch ? +numMatch[1] : e.index,
    title: e.title,
    date: e.pubDate,
    duration: e.duration,
    seconds: e.seconds,
    link: e.link.split('?')[0],
    audio: e.audio,
    intro,
    chapters,
    rawText: body.slice(0, 6000),
  };
});
fs.writeFileSync(path.join(__dirname, 'episodes.json'), JSON.stringify(out, null, 2));
console.log('parsed', out.length);
for (const e of out.slice(-3).reverse()) {
  console.log('\n=====', e.index, e.title, e.duration, 'chapters', e.chapters.length);
  console.log('INTRO:', e.intro.slice(0, 500));
  console.log('CH:', e.chapters.slice(0, 3));
}
console.log('\nchapters total', out.reduce((a, b) => a + b.chapters.length, 0));
console.log('episodes without chapters', out.filter(e => !e.chapters.length).map(e => e.index + ' ' + e.title).join('\n'));
