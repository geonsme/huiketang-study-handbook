const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const transDir = path.join(__dirname, 'transcripts');
const files = fs.existsSync(transDir) ? fs.readdirSync(transDir) : [];

const keywords = ['投资','资产','配置','风险','收益','基金','股票','市场','周期','组合','回撤','杠杆','现金','保险','债券','黄金','商品','通胀','利率','政策','经济','财富','家庭','养老','健康','读书','认知','选择','时代','行业','公司','估值','泡沫','危机','美元','人民币','关税','AI','科技','量化','指数','红利','私募','公募','基金经理','再平衡','安全','自由','焦虑','信任','长期','概率','分散','止损','止盈','消费','房产','房子','现金流','负债','目标','边界','框架','信息','信源','情绪','人性','周期','复利','Beta','Alpha','FOF','ETF','CTA'];

function fmt(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function score(text) {
  let s = 0;
  for (const k of keywords) if (text.includes(k)) s += 1;
  if (/关注|订阅|通知|聆听|点赞|评论|转发|加群|微信|二维码|小助手|下期|片尾|彩蛋|广告|赞助|购买|优惠|链接/.test(text)) s -= 6;
  s += Math.min(text.length, 120) / 80;
  if (/[？?]$/.test(text)) s += .4;
  if (/^(那么|然后|就是|这个|那个|所以|但是|因为|如果|其实|我们|大家|今天|首先|第二|第三)/.test(text)) s -= .2;
  return s;
}
function pickKey(chunks) {
  if (!chunks || !chunks.length) return [];
  let valid = chunks
    .map((c, i) => ({ ...c, i, s: score(c.text || '') }))
    .filter(c => c.text && c.text.length >= 35 && c.text.length <= 500 && (score(c.text) >= 2));
  if (valid.length < 3) {
    valid = chunks
      .map((c, i) => ({ ...c, i, s: score(c.text || '') }))
      .filter(c => c.text && c.text.length >= 35 && c.text.length <= 500 && !/关注|订阅|通知|聆听|点赞|评论|转发|加群|微信|二维码|小助手|下期|片尾|广告|赞助|购买|优惠|链接/.test(c.text));
  }
  if (!valid.length) return [];
  const duration = Math.max(...chunks.map(c => c.end || 0), 1);
  const buckets = 8;
  const picked = [];
  for (let b = 0; b < buckets; b++) {
    const lo = duration * b / buckets, hi = duration * (b + 1) / buckets;
    const inBucket = valid.filter(c => c.start >= lo && c.start < hi);
    if (inBucket.length) {
      inBucket.sort((a, b2) => b2.s - a.s);
      picked.push(inBucket[0]);
    }
  }
  // de-duplicate similar text
  const out = [];
  for (const c of picked.sort((a,b)=>a.start-b.start)) {
    if (out.some(x => x.text.slice(0,18) === c.text.slice(0,18))) continue;
    out.push({ t: fmt(c.start), text: c.text.trim(), start: c.start, end: c.end });
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
        e.transcript = { chunks: t.chunks, text: t.text || '', seconds: t.seconds || e.seconds };
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

data.podcast.transcribedCount = transcribed;
data.podcast.transcriptChars = totalChars;
data.podcast.transcriptWan = (totalChars / 10000).toFixed(1);
fs.writeFileSync(path.join(__dirname, 'data-v2.json'), JSON.stringify(data, null, 2));
console.log('transcribed', transcribed, '/', data.episodes.length, 'chars', totalChars, 'wan', data.podcast.transcriptWan);
console.log('episodes with key chunks', data.episodes.filter(e => e.keyChunks.length).length);
console.log('sample', data.episodes.find(e => e.keyChunks.length)?.keyChunks.slice(0,3));
