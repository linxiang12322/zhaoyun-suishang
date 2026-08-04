// 规则拆解引擎单元测试（从 app.js 提取函数独立验证）
const fs = require('fs');
const src = fs.readFileSync('app.js', 'utf8');

const cnMatch = src.match(/const CN_NUM = \{.*?\};/);
const fnMatch = src.match(/function parseByRules\(text\) \{[\s\S]*?\n  \}/);
if (!cnMatch || !fnMatch) { console.error('提取失败'); process.exit(1); }
eval(cnMatch[0] + '\n' + fnMatch[0]);

const tests = [
  { in: '明早去银行，下午三点开会，晚上有空健身', expect: 3 },
  { in: '周五前交方案，明天下午先做两小时', expect: 2 },
  { in: '晚点提醒我给妈妈打电话', expect: 1 },
  { in: '明天下午三点和客户开会，晚上健身一小时', expect: 2 },
  { in: '周末整理读书笔记，顺便买咖啡豆', expect: 2 },
  { in: '今天中午十二点半和同事吃饭，记得下午两点发周报', expect: 2 }
];

let pass = 0;
tests.forEach(t => {
  const r = parseByRules(t.in);
  const ok = r.length === t.expect;
  if (ok) pass++;
  console.log((ok ? 'PASS' : 'FAIL') + ` [期望${t.expect}项/实际${r.length}项] "${t.in}"`);
  r.forEach(x => console.log(`   - ${x.title} | ${x.typeLabel} | ${x.date} ${x.start} | ${x.dur} | ${x.pri} | ${x.sync} | pending:[${x.pending}]`));
});
console.log(`\n${pass}/${tests.length} 通过`);
process.exit(pass === tests.length ? 0 : 1);
