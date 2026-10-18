const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const transDir = path.join(__dirname, 'transcripts');

const keywords = ['投资','资产','配置','风险','收益','基金','股票','市场','周期','组合','回撤','杠杆','现金','保险','债券','黄金','商品','通胀','利率','政策','经济','财富','家庭','养老','健康','读书','认知','选择','时代','行业','公司','估值','泡沫','危机','美元','人民币','关税','AI','科技','量化','指数','红利','私募','公募','基金经理','再平衡','安全','自由','焦虑','信任','长期','概率','分散','止损','止盈','消费','房产','房子','现金流','负债','目标','边界','框架','信息','信源','情绪','人性','复利','Beta','Alpha','FOF','ETF','CTA','职业','工作','教育','孩子','婚姻','关系','客户','产品','策略','超额','基差','波动'];

function fmt(sec) {
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function fix(text) {
  return text
    .replace(/会课堂|惠客堂|慧课堂/g, '慧客堂')
    .replace(/持币带涨/g, '持币待涨')
    .replace(/大跑跑输/g, '大幅跑输')
    .replace(/跑输的时代/g, '跑输了时代')
    .replace(/想的不少，跌的不多/g, '涨得不少，跌得不多')
    .replace(/增执/g, '增值')
    .replace(/但吧有/g, '但还有')
    .replace(/很行/g, '很好')
    .replace(/以到一条曲线/g, '画到一条曲线')
    .replace(/在在有线线上/g, '在有效前沿上')
    .replace(/息跳反应/g, '膝跳反应')
    .replace(/俄无冲突/g, '俄乌冲突')
    .replace(/基基础/g, '基础')
    .replace(/在在/g, '在')
    .replace(/的的/g, '的')
    .replace(/我我/g, '我')
    .replace(/了了/g, '了')
    .replace(/是是/g, '是')
    .replace(/不不/g, '不')
    .replace(/有有/g, '有')
    .replace(/就就/g, '就')
    .replace(/对对/g, '对')
    .replace(/[嗯呃哦啊诶唉哎]/g, '')
    .replace(/f\s*o\s*f|forf|负户/gi, 'FOF')
    .replace(/e\s*t\s*f/gi, 'ETF')
    .replace(/c\s*t\s*a/gi, 'CTA')
    .replace(/g\s*d\s*p/gi, 'GDP')
    .replace(/c\s*p\s*i/gi, 'CPI')
    .replace(/p\s*p\s*i/gi, 'PPI')
    .replace(/a股/g, 'A股');
}
function splitSentences(text) {
  return (text || '')
    .replace(/\s+/g, '')
    .split(/(?<=[。！？；!?;])/)
    .map(s => s.trim())
    .filter(Boolean);
}
function cleanSentence(s) {
  s = s.replace(/^(嗯|呃|啊|哦|诶|唉|哎)[，,、\s]*/g, '');
  s = s.replace(/^(那么|然后|就是|这个|那个|所以|但是|因为|其实|然后呢|那)[，,、\s]*/g, '');
  s = fix(s);
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  s = s.replace(/\s+/g, '');
  return s.trim();
}
function score(s) {
  let v = 0;
  for (const k of keywords) if (s.includes(k)) v += 1;
  v += Math.min(s.length, 100) / 100;
  if (/[？?]$/.test(s)) v += .3;
  if (/关注|订阅|通知|聆听|点赞|评论|转发|加群|微信|二维码|小助手|下期|片尾|广告|赞助|购买|优惠|链接|抽奖|福利/.test(s)) v -= 8;
  if ((s.match(/嗯|呃|啊|哦|这个|那个|就是|然后/g)||[]).length >= 4) v -= 2;
  return v;
}
function pickKey(chunks) {
  if (!chunks || !chunks.length) return [];
  const cands = [];
  for (const c of chunks) {
    for (const raw of splitSentences(c.text)) {
      const s = cleanSentence(raw);
      if (s.length < 18 || s.length > 130) continue;
      if (!/[。！？；]$/.test(s)) continue;
      const sc = score(s);
      if (sc < 1.4) continue;
      cands.push({ t: fmt(c.start), text: s, start: c.start, end: c.end, sc });
    }
  }
  if (!cands.length) return [];
  const duration = Math.max(...chunks.map(c => c.end || 0), 1);
  const picked = [];
  for (let b = 0; b < 8; b++) {
    const lo = duration * b / 8, hi = duration * (b + 1) / 8;
    const inB = cands.filter(c => c.start >= lo && c.start < hi).sort((a,b2)=>b2.sc-a.sc);
    if (inB.length) picked.push(inB[0]);
  }
  if (picked.length < 5) {
    for (const c of cands.slice().sort((a,b)=>b.sc-a.sc)) {
      if (!picked.includes(c)) picked.push(c);
      if (picked.length >= 6) break;
    }
  }
  const out = [];
  for (const c of picked.slice().sort((a,b)=>a.start-b.start)) {
    if (out.some(x => x.text.slice(0,14) === c.text.slice(0,14))) continue;
    out.push({ t: c.t, text: c.text, start: c.start, end: c.end });
  }
  return out.slice(0, 8);
}

let totalChars = 0, transcribed = 0;
for (const e of data.episodes) {
  const f = path.join(transDir, `${e.n}.json`);
  e.transcript = null;
  e.keyChunks = [];
  e.transcriptChars = 0;
  if (fs.existsSync(f)) {
    try {
      const t = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (t.chunks && t.chunks.length) {
        e.transcript = { chunks: t.chunks.map(c => [fmt(c.start), c.text || '']), seconds: t.seconds || e.seconds };
        e.keyChunks = pickKey(t.chunks);
        e.transcriptChars = (t.text || '').length;
        totalChars += e.transcriptChars;
        transcribed++;
      }
    } catch (err) {
      console.error('bad transcript', e.n, err.message);
    }
  }
}

// module-level original quotes
for (const m of data.modules) {
  const cands = [];
  const seenEp = new Set();
  const eps = data.episodes.filter(e => (e.mods||[]).includes(m.id));
  for (const e of eps) {
    if (!e.keyChunks || !e.keyChunks.length) continue;
    for (const c of e.keyChunks) {
      if (seenEp.has(e.n) && e.n !== m.eps[0]) continue;
      cands.push({ n: e.n, label: e.label, t: c.t, text: c.text, start: c.start, sc: c.text.length });
    }
  }
  // prefer curated eps, but keep diversity
  cands.sort((a,b)=>b.sc-a.sc);
  const picked = [];
  for (const c of cands) {
    if (picked.some(x => x.n === c.n)) continue;
    if (picked.some(x => x.text.slice(0,12) === c.text.slice(0,12))) continue;
    picked.push(c);
    if (picked.length >= 4) break;
  }
  m.quotes = picked.map(c => ({ n: c.n, label: c.label, t: c.t, text: c.text }));
}

data.podcast.transcribedCount = transcribed;
data.podcast.transcriptChars = totalChars;
data.podcast.transcriptWan = (totalChars / 10000).toFixed(1);
fs.writeFileSync(path.join(__dirname, 'data-v2.json'), JSON.stringify(data, null, 2));
console.log('transcribed', transcribed, '/', data.episodes.length, 'chars', totalChars, 'wan', data.podcast.transcriptWan);
console.log('episodes with key chunks', data.episodes.filter(e => e.keyChunks.length).length);
for (const n of [2, 5, 26, 31]) {
  const e = data.episodes.find(x => x.n === n);
  console.log('\n===', n, e.label, 'key', e.keyChunks.length);
  e.keyChunks.slice(0, 5).forEach(c => console.log('[' + c.t + ']', c.text));
}
