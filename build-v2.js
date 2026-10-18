const fs = require('fs');
const path = require('path');
const template = fs.readFileSync(path.join(__dirname, 'template-v2.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data-v2.json'), 'utf8'));
const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const logo = fs.readFileSync(path.join(__dirname, 'cover.png')).toString('base64');
const html = template.replace('/*__DATA__*/', json).replace(/__LOGO__/g, 'data:image/png;base64,' + logo);
const out1 = path.join(__dirname, '慧客堂·学习手册-v2.html');
fs.writeFileSync(out1, html, 'utf8');
console.log('written', out1, (html.length / 1024).toFixed(0) + 'KB');

// Qoder Site 实际绑定的是会话目录，而不是本项目目录；按 site_config.json 同步过去。
// --no-site-sync 用于转写后的草稿构建，精读完成后再做最终构建并同步，避免半成品进入可发布目录。
const doSiteSync = !process.argv.includes('--no-site-sync');
const cfgPath = path.join(__dirname, 'site_config.json');
if (doSiteSync && fs.existsSync(cfgPath)) {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (!cfg.siteRoot) throw new Error('site_config.json 缺少 siteRoot');
  const webDir = path.join(cfg.siteRoot, cfg.webDirectory || 'dist');
  fs.mkdirSync(webDir, { recursive: true });
  const siteIndex = path.join(webDir, 'index.html');
  fs.writeFileSync(siteIndex, html, 'utf8');
  const siteCopy = path.join(cfg.siteRoot, '慧客堂·学习手册.html');
  fs.writeFileSync(siteCopy, html, 'utf8');
  console.log('site synced', siteIndex);
} else {
  console.log(doSiteSync ? 'site_config.json missing: local build only' : 'draft build: site sync skipped');
}
console.log('episodes', data.episodes.length, 'modules', data.modules.length, 'principles', data.principles.length);
