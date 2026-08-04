// 原型静态校验：HTML 标签配对 + id 引用核对
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('app.js', 'utf8');

const voidTags = new Set(['meta', 'link', 'br', 'img', 'input', 'hr']);
const stack = [];
const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
let m, err = [];
while ((m = re.exec(html))) {
  const full = m[0], tag = m[1];
  if (full.startsWith('</')) {
    const top = stack.pop();
    if (top !== tag) { err.push('Mismatch: expected </' + top + '> got </' + tag + '>'); break; }
  } else if (!full.endsWith('/>') && !voidTags.has(tag)) stack.push(tag);
}
if (stack.length) err.push('Unclosed: ' + stack.join(','));

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(x => x[1]));
const refs = new Set([...js.matchAll(/\$\$?\('#([a-zA-Z][a-zA-Z0-9]*)'\)/g)].map(x => x[1]));
const missing = [...refs].filter(r => !ids.has(r) && r !== 'retryBtn'); // retryBtn 为动态渲染

console.log('HTML:', err.length ? 'ERRORS ' + err.join('; ') : 'OK');
console.log('screens:', (html.match(/data-screen=/g) || []).length);
console.log('id refs checked:', refs.size, '| missing:', missing.length ? missing.join(',') : 'none');
process.exit(err.length || missing.length ? 1 : 0);
