const fs = require('fs');
const path = require('path');
const feed = JSON.parse(fs.readFileSync(path.join(__dirname, 'feed.json'), 'utf8'));
const { EP_META, MODULES, PRINCIPLES, PHASES, PATHS, BOOKS, GLOSSARY } = require('./meta.js');

// A few episodes have empty RSS shownotes; fill from the official Apple Podcasts
// description or mark as trailer/no-notes so the archive is not silently blank.
const MANUAL = {
  1: { label: '开篇' },
  71: {
    paras: [
      '🎙️ 主播：董艺婷（真话是我的态度，减法是我的选择。公众号：Beagle小猎犬号）；郭超（CFA，18年多领域投研交易，专注资产配置与固收策略研究）',
      '✨ 关于本期节目：这是 2026 年的第二期，也是有史以来最长、也最重的一期。我们站在一个新时代的门口，眼前展开的是一幅没人能画全的新世界地图。投资要长两只眼睛：既要“往外看”——看清宏观变局、科技爆炸与地缘棋局；也要“往内看”——理清自己的目标、框架与心性。',
      '节目分成七个部分：一、世界的叙事：从中美科技九大领域的暗战，到全球力量的重新站队。二、市场的体温：复盘 2025 年最赚钱的资产，回答“牛能不能过三”。三、牌桌上的玩家：公募、量化、险资这些机构到底在干什么，你又该如何自处。四、2026 的猜想：对一季度及全年核心变量的推演与警惕。五、你的财富地图：一个完整的、让你能“睡得着”的资产配置框架与执行心法。六、回答你的问题：从上百个听众问题中，提炼关于止盈、行业、风险、心态的真诚回答。七、新年彩蛋：投资经理的快问快答，与听众的真实故事。',
      '如果你关心未来，会听到对 AI、机器人、商业航天最深层的期待与敬畏；如果你关心投资，会得到一个穿越周期、动态平衡的正念框架；如果你感到焦虑或迷茫，会发现那些让你睡不着的问题，大多源于结构和视角。'
    ],
    chapters: [
      { t: '00:20', text: '开场：站在新时代的门口，投资要长两只眼睛' },
      { t: '04:24', text: '一、世界的叙事：中美科技九大领域的暗战' },
      { t: '31:21', text: '全球力量的重新站队与地缘棋局' },
      { t: '1:01:49', text: '二、市场的体温：2025 年大类资产表现' },
      { t: '1:04:57', text: '不同资产配置方案 2025 年表现如何' },
      { t: '1:08:37', text: '市场拥挤度与资产属性再定义' },
      { t: '1:16:32', text: '债市复盘' },
      { t: '1:24:37', text: '商品与 CTA 策略回顾' },
      { t: '1:27:56', text: '当前资产配置如何调整' },
      { t: '1:30:50', text: '三、机构行为：公募基金 2025 年操作特征' },
      { t: '1:37:07', text: '聪明钱 VS 韭菜钱' },
      { t: '1:41:31', text: '保险、银行理财、海外对冲基金' },
      { t: '1:47:14', text: '研究机构行为的意义：观察共识与潜在踩踏' },
      { t: '1:54:35', text: '四、2026 年市场猜想：股票市场动因与增量资金' },
      { t: '2:00:41', text: '2026 年投资考验：解放思想、实事求是' },
      { t: '2:03:12', text: '五、个人财富管理框架：完整的四步框架' },
      { t: '2:17:44', text: '两只眼睛看世界，一个内核守财富' },
      { t: '2:22:06', text: '什么是真正有效的分散原则' },
      { t: '2:32:47', text: '六、听众问答：宏观与周期' },
      { t: '2:47:05', text: '投资操作：止盈、止损、定投' },
      { t: '2:58:26', text: '行业与资产：科技、消费、汇率、利率' },
      { t: '3:11:17', text: '心理与玄学：投资焦虑、玄学预测' },
      { t: '3:17:21', text: '七、彩蛋：家庭财富管理体系的全维度应对方案' }
    ],
    intro: '这是 2026 年的第二期，也是有史以来最长、最重的一期。投资要长两只眼睛：既要“往外看”——看清宏观变局、科技爆炸与地缘棋局；也要“往内看”——理清自己的目标、框架与心性。'
  },
  47: {
    trailer: true,
    note: '本期音频为 3 分钟预告，官方 Shownotes 附有完整节目章节（约 1 小时 32 分）。可以先用章节地图建立框架，再找完整版收听。'
  },
  16: {
    note: '官方未附 Shownotes。这是一期关于风险、生存与长期主义的独白，建议直接收听原节目。'
  }
};

const decode = (s) => s
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (a, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (a, d) => String.fromCodePoint(+d));

function cleanShownotes(html) {
  let s = html;
  // remove images
  s = s.replace(/<img[^>]*>/gi, '');
  // remove explicit transcript footer & common footer
  s = s.replace(/在小宇宙查看该单集文稿[\s\S]*$/i, '');
  s = s.replace(/我们是谁[\s\S]*$/i, '');
  // paragraph / list breaks
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<\/li>/gi, '\n');
  s = s.replace(/<\/(div|h[1-6]|blockquote)>/gi, '\n');
  // links: keep text
  s = s.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1');
  // strip remaining tags
  s = s.replace(/<[^>]+>/g, '');
  s = decode(s);
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/^\s+|\s+$/g, '');
  return s;
}

function toParagraphs(text) {
  return text.split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
}

function extractChapters(text, maxSeconds = 8 * 3600) {
  const chapters = [];
  const lines = text.split('\n');
  const durSec = (t) => { const p = t.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  for (let line of lines) {
    line = line.trim().replace(/^[•*\-–—]+\s*/, '');
    if (!line) continue;
    // normalise odd "1:09 56 title" formatting into 1:09:56
    line = line.replace(/^(\d{1,2}:\d{2})\s(\d{2})\s+/, '$1:$2 ');
    const m = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[｜|:：\-–—]\s*)?(.{2,})$/);
    if (m) {
      const title = m[2].trim();
      if (title.length < 2) continue;
      if (durSec(m[1]) > maxSeconds + 600) continue;
      chapters.push({ t: m[1], text: title });
    }
  }
  // de-duplicate by time+text
  const seen = new Set();
  return chapters.filter(c => {
    const k = c.t + '|' + c.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function getIntro(text, chapters) {
  if (!chapters.length) {
    const paras = toParagraphs(text);
    return paras.slice(0, 2).join('\n\n').slice(0, 900);
  }
  const firstTime = chapters[0].t;
  const idx = text.search(new RegExp(`(?:^|\\n)\\s*${firstTime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  if (idx > 0) return text.slice(0, idx).trim().slice(0, 1200);
  return '';
}

function chineseDate(pubDate) {
  const d = new Date(pubDate);
  const fmt = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(d);
  const get = t => parts.find(p => p.type === t)?.value;
  return `${get('year')}.${get('month')}.${get('day')}`;
}

const episodes = feed.map((e, i) => {
  const n = e.index;
  const meta = EP_META[n] || {};
  const text = cleanShownotes(e.shownotes);
  const chapters = extractChapters(text);
  const intro = getIntro(text, chapters);
  const volMatch = e.title.match(/(?:Vol\.|V)(\d+)/i);
  const vol = volMatch ? +volMatch[1] : null;
  let label = vol !== null ? `Vol.${vol}` : '特别篇';
  if (/^V\d+/.test(e.title) && !/^Vol\./i.test(e.title)) label = `V${vol}`;
  return {
    n,
    vol,
    label,
    title: e.title,
    date: chineseDate(e.pubDate),
    duration: e.duration.replace(/^00:/, '').replace(/^0(?=\d:)/, ''),
    seconds: e.seconds,
    link: e.link.split('?')[0],
    audio: e.audio,
    intro,
    chapters,
    paras: toParagraphs(text),
    tags: meta.tags || [],
    mods: meta.mods || [],
    line: meta.line || '',
    core: !!meta.core,
    points: meta.points || [],
  };
});

// Apply manual overrides for episodes with missing or malformed RSS shownotes.
episodes.forEach(e => {
  const m = MANUAL[e.n];
  if (!m) return;
  if (m.paras) { e.paras = m.paras; e.intro = m.intro || m.paras[0]; }
  if (m.chapters) e.chapters = m.chapters;
  if (m.trailer) e.trailer = true;
  if (m.label) e.label = m.label;
  if (m.note) e.note = m.note;
});

// Manually fix a couple of chapter glitches from RSS formatting
const fixChapter = (n, wrongTime, rightTime, includes) => {
  const ep = episodes.find(e => e.n === n);
  if (!ep) return;
  const c = ep.chapters.find(c => c.t === wrongTime && c.text.includes(includes));
  if (c) c.t = rightTime;
};
fixChapter(3, '00:46', '00:46', '1999');
fixChapter(102, '01:02', '01:02', '董总');
episodes.forEach(e => {
  // put chapters in chronological order but keep original order; sort only if clearly out of order
  const sec = t => { const p = t.split(':').map(Number); return p.length === 3 ? p[0]*3600+p[1]*60+p[2] : p[0]*60+p[1]; };
  const isSorted = e.chapters.every((c, i, a) => i === 0 || sec(a[i-1].t) <= sec(c.t));
  if (!isSorted) e.chapters.sort((a, b) => sec(a.t) - sec(b.t));
});

const data = {
  podcast: {
    title: '慧客堂',
    subtitle: '一档关于经营幸福的读书播客',
    host: '董艺婷',
    hostBio: '21 年买方投资，量化 FOF 管理人，至明科技/慧度至明出品。公众号「Beagle小猎犬号」，小红书「开始董了」。',
    description: '审视投资、财富与生活，做穿越周期的思考；守护家庭财富，做有温度的决定。',
    count: episodes.length,
    hours: (episodes.reduce((a, b) => a + b.seconds, 0) / 3600).toFixed(1),
    chapters: episodes.reduce((a, b) => a + b.chapters.length, 0),
    firstDate: episodes[episodes.length - 1].date,
    lastDate: episodes[0].date,
    cover: 'https://image.xyzcdn.net/FlRnpB8R_ipkbmvP1LmAs3JKF-xR.png@large',
    url: 'https://www.xiaoyuzhoufm.com/podcast/66e02b91edda3e1cdaa6b628',
  },
  modules: MODULES,
  principles: PRINCIPLES,
  phases: PHASES,
  paths: PATHS,
  books: BOOKS,
  glossary: GLOSSARY,
  episodes,
};

fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 2));
console.log('episodes', episodes.length, 'core', episodes.filter(e => e.core).length, 'chapters', data.podcast.chapters, 'hours', data.podcast.hours);
console.log('with chapters', episodes.filter(e => e.chapters.length > 0).length, 'no chapters', episodes.filter(e => !e.chapters.length).map(e => e.n).join(','));
console.log('notes chars', episodes.reduce((a, b) => a + b.paras.join('').length, 0));
console.log('sample', JSON.stringify({ ...episodes[0], paras: episodes[0].paras.slice(0, 3), chapters: episodes[0].chapters.slice(0, 4) }, null, 2).slice(0, 1500));
console.log('no line', episodes.filter(e => !e.line).map(e => e.n));
console.log('no mods', episodes.filter(e => !e.mods.length).map(e => e.n));
