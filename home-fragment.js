function renderHome(){
  const p = DATA.podcast;
  const picks = [
    { n: 2, reason: '先建立投资世界观：承认看不懂、识别立场偏差，再按资金期限选择打法。', core: ['看不懂', '立场偏差', '资金属性'] },
    { n: 5, reason: '家庭财富不是买产品，而是把“我想照顾谁”写进信托、关系与传承里。', core: ['家庭工具箱', '信托', '传承'] },
    { n: 15, reason: '看一位 21 年买方如何用 FOF 做配置：越微观越算法，越宏观越人脑。', core: ['FOF', '方法论多样性', '敬畏'] },
    { n: 26, reason: '把黄金、商品、CTA 与危机 Alpha 一次讲清，也讲清它们什么时候失效。', core: ['商品定价', '危机 Alpha', 'CTA'] },
    { n: 27, reason: '分清 Beta 与 Alpha，用四问拆指数、指增与 ETF，不再被“增强”两个字带走。', core: ['宽基', '指增', '跟踪误差'] },
    { n: 43, reason: '低利率时代，收益要靠微观结构与再平衡，而不是相信 5%-6% 的“无风险”。', core: ['微观年', '拥挤度', '哑铃'] },
    { n: 60, reason: '周期是地图不是时钟；普通人只需要“模糊的准确”和一套指标打分表。', core: ['周期嵌套', '情绪钟摆', '打分表'] },
    { n: 71, reason: '用“往外看 / 往内看”两只眼睛，搭一个 2026 年睡得踏实的资产配置。', core: ['世界叙事', '机构行为', '财富地图'] },
    { n: 97, reason: '十年踩坑复盘：合同、结构、利益一致性，比明星项目和背书更重要。', core: ['股权份额', '工商变更', '双录'] },
    { n: 106, reason: '两种人生、四层资产：以支定收，先算下限，再谈自由。', core: ['四层资产', '以支定收', '现金流'] },
  ];

  $('#view-home').innerHTML = `
  <div class="hero">
    <img class="hero-cover" src="__LOGO__" alt="慧客堂封面">
    <div class="wrap hero-inner">
      <div class="eyebrow">播客学习手册 · ${p.firstDate} — ${p.lastDate}</div>
      <h1>把「慧客堂」<br>读成一本<br><em>人生的资产配置书</em></h1>
      <p class="hero-lead"><strong>${p.count} 期，${p.hours} 小时。</strong>先读 10 期精华，建立投资、配置与人生的框架；想深入时，再按 Vol 或模块回到原声。</p>
      <div class="hero-stats">
        <div class="hero-stat"><b>${p.count}</b><span>期节目</span></div>
        <div class="hero-stat"><b>${p.hours}</b><span>小时音频</span></div>
        <div class="hero-stat"><b>${DATA.podcast.transcriptWan || 0}</b><span>万字逐字稿</span></div>
        <div class="hero-stat"><b>${DATA.episodes.filter(e=>e.core).length}</b><span>期精读</span></div>
      </div>
      <div class="hero-actions">
        <button class="btn btn-primary" data-scroll="picks">开始精读 <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"></path></svg></button>
        <button class="btn btn-ghost" data-go="episodes">按 Vol 浏览</button>
      </div>
      <div class="tr-status"><span class="tr-dot"></span>逐字稿 ${DATA.podcast.transcribedCount || 0}/111 期已转写 · ${DATA.podcast.transcriptWan || 0} 万字原文</div>
    </div>
  </div>

  <div class="wrap">
    <section class="section picks-section" id="picks">
      <div class="section-head">
        <div>
          <div class="kicker">Quick Start</div>
          <h2>10 期精读，先读精华</h2>
          <div class="sub">每期只留一句“为什么读”和三个核心词；读完再回原声。</div>
        </div>
        <button class="link-more" data-epfilter="core">34 期精读 <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"></path></svg></button>
      </div>
      <div class="picks">
        ${picks.map((x, i) => {
          const e = byId[x.n];
          if (!e) return '';
          return `<button class="pick-item" data-ep="${e.n}">
            <span class="pick-no">${pad(i + 1)}</span>
            <span class="pick-main">
              <span class="pick-top"><span class="pick-vol">${esc(e.label)}</span><span class="pick-dur">${durText(e)}</span>${e.core ? '<span class="core-tag">精读</span>' : ''}</span>
              <span class="pick-title">${esc(shortTitle(e, 34))}</span>
              <span class="pick-reason"><b>为什么读</b>${esc(x.reason)}</span>
              <span class="pick-core">${x.core.map(c => `<span>${esc(c)}</span>`).join('')}</span>
            </span>
            <span class="pick-arrow">→</span>
          </button>`;
        }).join('')}
      </div>
      <div class="picks-foot">
        <button class="btn btn-ghost" data-epfilter="all">查看全部 111 期</button>
        <span>覆盖投资世界观、家庭财富、FOF、商品、指数、周期、配置、踩坑与人生。</span>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><div class="kicker">Two Ways</div><h2>接下来怎么读</h2><div class="sub">按时间，或按主题；两条路都能回到同一份原文。</div></div></div>
      <div class="two-ways">
        <button class="way-card" data-go="episodes">
          <span class="way-no">111</span>
          <span class="way-title">按 Vol</span>
          <span class="way-desc">从 2024.10 开篇到 V110，按时间读完整 111 期。</span>
          <span class="way-go">进入时间线 →</span>
        </button>
        <button class="way-card" data-go="modules">
          <span class="way-no">08</span>
          <span class="way-title">按模块</span>
          <span class="way-desc">风险、配置、产品、周期、人生、读书、案例、方法，八个主题框架。</span>
          <span class="way-go">进入模块 →</span>
        </button>
      </div>
    </section>

    <section class="section">
      <div class="host-mini">
        <img src="__LOGO__" alt="慧客堂封面">
        <div class="host-mini-main">
          <div class="hm-name">董艺婷 <span>董总</span></div>
          <div class="hm-role">21 年买方投资 · 量化 FOF 管理人</div>
          <p>真话是态度，减法是选择。节目聊投资，也聊家庭、健康、读书与中年重启。</p>
        </div>
        <button class="hm-more" data-go="modules">她的方法 →</button>
      </div>
    </section>

    <section class="section">
      <div class="home-note">
        <b>全量版</b> · 111 期逐字稿 · 34 期完整精读 · 8 个模块 · 350.8 万字原文。每天 09:00 自动检查 RSS，新增期会转写、生成分析并更新本页。
        <div class="home-note-links"><button data-go="me">我的笔记 / 关于</button><a href="${p.url}" target="_blank" rel="noopener">小宇宙播客主页</a></div>
      </div>
    </section>
  </div>`;

  applyHighlights($('#view-home'));
}
