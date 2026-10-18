const fs = require('fs');
const path = require('path');
const xml = fs.readFileSync(path.join(__dirname, '..', 'feed.xml'), 'utf8');
const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
const dec = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/&#x([0-9a-f]+);/gi, (a, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (a, d) => String.fromCodePoint(+d));
const get = (x, t) => {
  const re = new RegExp('<' + t + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + t + '>');
  const m = x.match(re);
  return m ? dec(m[1]).trim() : '';
};
const getAttr = (x, t, attr) => {
  const re = new RegExp('<' + t + '[^>]*\\s' + attr + '="([^"]*)"');
  const m = x.match(re);
  return m ? dec(m[1]).trim() : '';
};
const parseDur = t => {
  if (!t) return 0;
  const p = t.split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0] || 0;
};
const data = items.map((x, i) => {
  const desc = get(x, 'description');
  const content = get(x, 'content:encoded');
  return {
    index: items.length - i,
    title: get(x, 'title'),
    link: get(x, 'link'),
    guid: get(x, 'guid'),
    pubDate: get(x, 'pubDate'),
    duration: get(x, 'itunes:duration'),
    seconds: parseDur(get(x, 'itunes:duration')),
    audio: getAttr(x, 'enclosure', 'url'),
    size: +getAttr(x, 'enclosure', 'length') || 0,
    desc,
    shownotes: content.length > desc.length ? content : desc,
  };
});
fs.writeFileSync(path.join(__dirname, 'feed.json'), JSON.stringify(data, null, 2));
const total = data.reduce((a, b) => a + b.seconds, 0);
console.log('episodes', data.length, 'total hours', (total / 3600).toFixed(1), 'total MB', (data.reduce((a, b) => a + b.size, 0) / 1048576).toFixed(0));
console.log('oldest:', data[data.length - 1].title, data[data.length - 1].pubDate, data[data.length - 1].duration);
console.log('newest:', data[0].title, data[0].pubDate, data[0].duration);
console.log(JSON.stringify({ ...data[0], audio: data[0].audio.slice(0, 80), shownotes: data[0].shownotes.slice(0, 300) }, null, 2));
