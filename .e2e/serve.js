// 巢雲随行 · 开发服务器（E2E + LLM 代理，零依赖）
// - 静态文件服务（index.html/app.js/styles.css/llm.js/...）
// - POST /api/parse : LLM 精准拆解代理（OpenAI 兼容），key 由服务端环境变量持有
//   环境变量：
//     LLM_PROVIDER=deepseek|doubao|openai（默认 deepseek）
//     LLM_BASE / LLM_MODEL / LLM_API_KEY
//   未配置 LLM_API_KEY 时返回 503 { error: 'LLM_NOT_CONFIGURED' }，前端回退规则引擎
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const PROVIDERS = {
  deepseek: { base: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  doubao: { base: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  openai: { base: '', model: '' }
};

async function handleParse(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    let payload;
    try { payload = JSON.parse(body || '{}'); } catch (e) { payload = {}; }
    const text = (payload.text || '').toString().trim();
    if (!text) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'EMPTY_TEXT' })); return; }

    const provider = process.env.LLM_PROVIDER || 'deepseek';
    const apiKey = process.env.LLM_API_KEY || '';
    const base = process.env.LLM_BASE || (PROVIDERS[provider] || {}).base || '';
    const model = process.env.LLM_MODEL || (PROVIDERS[provider] || {}).model || '';
    if (!apiKey || !base) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'LLM_NOT_CONFIGURED', provider }));
      return;
    }
    // 复用 llm.js 的 prompt 构造与输出解析（Node 端 require，路径相对仓库根）
    let llm;
    try { llm = require(path.join(root, 'llm.js')); } catch (e) { llm = null; }
    if (!llm) { res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'LLM_MODULE_MISSING' })); return; }

    try {
      // 复用 llm.js 的 prompt 构造 / 请求 / 输出解析，避免两处逻辑漂移
      const tasks = await llm.parseWithLLM(text, {
        provider: { provider, base, model, apiKey },
        todayHint: payload.todayHint,
        timeoutMs: 25000
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ tasks, provider, model }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'LLM_PROXY_FAIL', detail: String(e && e.message || e).slice(0, 200) }));
    }
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8765');
  if (req.method === 'POST' && url.pathname === '/api/parse') { handleParse(req, res); return; }
  const urlPath = decodeURIComponent(url.pathname);
  let file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8765, '127.0.0.1', () => console.log('serving on 8765 (LLM proxy ready)'));
