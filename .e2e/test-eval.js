// ============================================================
// 巢雲随行 · 精准拆解对比评测（规则引擎 vs LLM）
//
// 用法：
//   node .e2e/test-eval.js                  # 仅规则引擎（离线）
//   node .e2e/test-eval.js --llm            # 规则引擎 + LLM（走本地代理，需先启动 serve.js 并配置 key）
//   node .e2e/test-eval.js --llm --direct   # 规则引擎 + LLM（直连，从环境变量读配置）
//
// 环境变量（直连模式）：LLM_PROVIDER / LLM_BASE / LLM_MODEL / LLM_API_KEY
// 评分：逐条用例跑各引擎，按 test-eval-cases.js 的 checks 通过率输出对比。
// ============================================================
const fs = require('fs');
const path = require('path');
const cases = require('../test-eval-cases.js');
const llm = require('../llm.js');

/* ---------- 规则引擎（从 app.js 提取 parseByRules） ---------- */
function loadRuleEngine() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const cnMatch = src.match(/const CN_NUM = \{.*?\};/);
  const fnMatch = src.match(/function parseByRules\(text\) \{[\s\S]*?\n  \}/);
  if (!cnMatch || !fnMatch) { console.error('提取规则引擎失败'); process.exit(1); }
  eval(cnMatch[0] + '\n' + fnMatch[0]);
  return parseByRules;
}

/* ---------- 通用评分 ---------- */
function gradeTasks(input, tasks) {
  const c = cases.find(x => x.input === input);
  if (!c) return { okList: [], allOk: false };
  const okList = c.checks.map(ch => {
    let r = false;
    try { r = ch.fn(tasks); } catch (e) { r = false; }
    return { desc: ch.desc, ok: r };
  });
  return { okList, allOk: okList.every(x => x.ok) };
}

function fmtTask(t) {
  return `${t.title} | ${t.typeLabel} | ${t.date} ${t.start} | ${t.dur} | ${t.pri} | ${t.sync} | pending:[${(t.pending || []).join(',')}] | dep:${t.dependsOn || '-'}`;
}

function printReport(name, results) {
  const pass = results.filter(r => r.allOk).length;
  console.log(`\n===== ${name}：${pass}/${results.length} 条通过 =====`);
  results.filter(r => !r.allOk).forEach(r => {
    console.log(`\n✗ "${r.input}"`);
    r.okList.forEach(k => console.log(`    ${k.ok ? 'PASS' : 'FAIL'} ${k.desc}`));
    if (r.tasks && r.tasks.length) {
      console.log('    实际拆解:');
      r.tasks.forEach(t => console.log('      - ' + fmtTask(t)));
    }
  });
  return pass;
}

/* ---------- 主流程 ---------- */
(async () => {
  const useLLM = process.argv.includes('--llm');
  const useDirect = process.argv.includes('--direct');
  const parseByRules = loadRuleEngine();

  // 1) 规则引擎（同步）
  const ruleResults = cases.map(c => {
    let tasks = [];
    try { tasks = parseByRules(c.input); } catch (e) { tasks = []; }
    const g = gradeTasks(c.input, tasks);
    return { input: c.input, tasks, okList: g.okList, allOk: g.allOk };
  });
  const rulePass = printReport('规则引擎 parseByRules', ruleResults);

  if (!useLLM) {
    console.log('\n[提示] 未加 --llm，仅评测规则引擎。加 --llm（代理）或 --llm --direct（直连）对比 LLM。');
    console.log('[提示] 当前无 LLM key 时 LLM 引擎不可用，规则引擎通过率即基准线。');
    process.exit(0);
  }

  // 2) LLM 引擎（异步，逐条串行）
  const llmName = useDirect ? 'LLM 直连' : 'LLM 代理(/api/parse)';
  const llmResults = [];
  for (const c of cases) {
    if (!c.input.trim()) { llmResults.push({ input: c.input, tasks: [], okList: gradeTasks(c.input, []).okList, allOk: gradeTasks(c.input, []).allOk }); continue; }
    let tasks = [];
    try {
      if (useDirect) {
        const provider = process.env.LLM_PROVIDER || 'deepseek';
        const cfg = {
          provider,
          base: process.env.LLM_BASE || llm.PROVIDERS[provider]?.base,
          model: process.env.LLM_MODEL || llm.PROVIDERS[provider]?.model,
          apiKey: process.env.LLM_API_KEY
        };
        if (!cfg.apiKey) throw new Error('未配置 LLM_API_KEY');
        tasks = await llm.parseWithLLM(c.input, { provider: cfg, todayHint: cases.today });
      } else {
        const resp = await fetch('http://127.0.0.1:8765/api/parse', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: c.input, todayHint: cases.today })
        });
        if (!resp.ok) {
          const j = await resp.json().catch(() => ({}));
          throw new Error('代理 ' + resp.status + ' ' + (j.error || ''));
        }
        tasks = (await resp.json()).tasks || [];
      }
    } catch (e) {
      console.error(`[LLM] 用例失败跳过: "${c.input.slice(0, 20)}..." -> ${e.message}`);
      tasks = [];
    }
    const g = gradeTasks(c.input, tasks);
    llmResults.push({ input: c.input, tasks, okList: g.okList, allOk: g.allOk });
  }
  const llmPass = printReport(llmName, llmResults);

  // 3) 对比结论
  console.log(`\n===== 对比结论 =====`);
  console.log(`规则引擎 ${rulePass}/${cases.length}，LLM ${llmPass}/${cases.length}`);
  if (llmPass > rulePass) console.log('→ LLM 在精准拆解场景显著优于规则引擎（验证 PRD 11 章正式版路径可行）');
  else if (llmPass === rulePass) console.log('→ 持平（可考虑规则引擎为主 + LLM 兜底混合）');
  else console.log('→ 规则引擎更优（建议检查 LLM prompt / 用例断言）');
  process.exit(0);
})();
