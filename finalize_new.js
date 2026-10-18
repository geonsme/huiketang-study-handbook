const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data-v2.json'), 'utf8'));

const keywords = ['投资','资产','配置','风险','收益','基金','股票','市场','周期','组合','回撤','杠杆','现金','保险','债券','黄金','商品','通胀','利率','政策','经济','财富','家庭','养老','健康','读书','认知','选择','时代','行业','公司','估值','泡沫','危机','美元','人民币','关税','AI','科技','量化','指数','红利','私募','公募','基金经理','再平衡','安全','自由','焦虑','信任','长期','概率','分散','止损','止盈','消费','房产','房子','现金流','负债','目标','边界','框架','信息','信源','情绪','人性','复利','Beta','Alpha','FOF','ETF','CTA','职业','工作','教育','孩子','婚姻','关系','客户','产品','策略','超额','基差','波动'];

function splitSentences(text) {
  return (text || '').replace(/\s+/g, '').split(/(?<=[。！？；!?;])/).map(s => s.trim()).filter(Boolean);
}
function cleanSentence(s) {
  s = s.replace(/^(嗯|呃|啊|哦|诶|唉|哎)[，,、\s]*/g, '');
  s = s.replace(/^(那么|然后|就是|这个|那个|所以|但是|因为|其实|然后呢|那)[，,、\s]*/g, '');
  s = s.replace(/会课堂|惠客堂|慧课堂/g, '慧客堂')
    .replace(/持币带涨/g, '持币待涨').replace(/大跑跑输/g, '大幅跑输')
    .replace(/跑输的时代/g, '跑输了时代').replace(/基基础/g, '基础')
    .replace(/在在/g, '在').replace(/的的/g, '的').replace(/我我/g, '我')
    .replace(/了了/g, '了').replace(/是是/g, '是').replace(/不不/g, '不')
    .replace(/有有/g, '有').replace(/就就/g, '就').replace(/对对/g, '对')
    .replace(/[嗯呃哦啊诶唉哎]/g, '');
  s = s.replace(/呢(?=[，。；])/g, '').replace(/^[，。；、]+/, '');
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
    for (const raw of splitSentences(c[1])) {
      const s = cleanSentence(raw);
      if (s.length < 18 || s.length > 130) continue;
      if (!/[。！？；]$/.test(s)) continue;
      const sc = score(s);
      if (sc < 1.4) continue;
      cands.push({ t: c[0], text: s, start: 0, sc });
    }
  }
  if (!cands.length) {
    for (const c of chunks) {
      const s = cleanSentence(c[1]);
      if (s.length >= 25) return [{ t: c[0], text: s.slice(0, 110) }];
    }
    return [];
  }
  const picked = [];
  const buckets = 8;
  const total = chunks.length;
  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor(total * b / buckets), hi = Math.floor(total * (b + 1) / buckets);
    const inB = cands.filter((c, i) => i >= lo && i < hi).sort((a,b2)=>b2.sc-a.sc);
    if (inB.length) picked.push(inB[0]);
  }
  const out = [];
  for (const c of picked) {
    if (out.some(x => x.text.slice(0,14) === c.text.slice(0,14))) continue;
    out.push({ t: c.t, text: c.text });
  }
  return out.slice(0, 8);
}

let changed = 0;
for (const e of data.episodes) {
  if (!e.transcript || !e.transcript.chunks || !e.transcript.chunks.length) continue;
  if (!e.transcriptChars) e.transcriptChars = e.transcript.chunks.reduce((a,c)=>a+(c[1]||'').length, 0);
  if (!e.keyChunks || !e.keyChunks.length) {
    e.keyChunks = pickKey(e.transcript.chunks);
    changed++;
  }
  if (!e.excerpts || !e.excerpts.length) e.excerpts = (e.keyChunks || []).slice(0, 6);
  if (!e.summary) e.summary = e.line;
  if (!e.points || !e.points.length) e.points = (e.keyChunks || []).slice(0, 3).map(c=>c.text);
  if (!e.analysis) e.analysis = [];
  if (!e.quotes) e.quotes = [];
  if (!e.pointsSource) e.pointsSource = 'transcript';
}
data.podcast.count = data.episodes.length;
data.podcast.hours = Math.round(data.episodes.reduce((a,e)=>a+(e.seconds||0),0)/36)/100;
data.podcast.transcribedCount = data.episodes.filter(e=>e.transcript).length;
data.podcast.transcriptChars = data.episodes.reduce((a,e)=>a+(e.transcriptChars||0),0);
data.podcast.transcriptWan = (data.podcast.transcriptChars/10000).toFixed(1);
fs.writeFileSync(path.join(__dirname, 'data-v2.json'), JSON.stringify(data, null, 2));
console.log('finalize_new changed', changed, 'episodes', data.episodes.length, 'wan', data.podcast.transcriptWan);
