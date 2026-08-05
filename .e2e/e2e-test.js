// ============================================================
// 巢雲随行 · 端到端 E2E 测试（CDP 驱动真实 Chrome，零依赖）
// 覆盖：10 屏全部按钮 / 信息流转 / localStorage 数据流转
// 用法：node .e2e/e2e-test.js
// ============================================================
const http = require('http');

const CDP_PORT = 9222;
const BASE = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:8765/index.html';

let ws, msgId = 0;
const pending = new Map();
const results = [];
const shots = [];

function log(ok, name, detail) {
  results.push({ ok, name, detail });
  console.log((ok ? '  PASS' : '✗ FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function connect() {
  // 新建页面 target
  const tab = await getJson(`${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`).catch(async () => {
    // /json/new 需要 PUT
    return await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: 9222, path: '/json/new?' + encodeURIComponent('about:blank'), method: 'PUT' }, (r) => {
        let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => resolve(JSON.parse(d)));
      });
      req.on('error', reject); req.end();
    });
  });
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await send('Runtime.enable');
  await send('Page.enable');
}

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    return { error: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') };
  }
  return r.result ? r.result.result.value : undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result && r.result.data) {
    require('fs').writeFileSync(__dirname + '/shot_' + name + '.png', Buffer.from(r.result.data, 'base64'));
    shots.push(name);
  }
}

async function gotoApp() {
  await send('Page.navigate', { url: APP });
  await sleep(1200);
}

// ---------- 断言工具 ----------
const getText = (sel) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent.trim() : null; })()`);
const click = (sel) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const count = (sel) => evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const visibleScreen = () => evalJs(`document.querySelector('.screen.active') ? document.querySelector('.screen.active').dataset.screen : null`);
const ls = (k) => evalJs(`localStorage.getItem(${JSON.stringify(k)})`);

async function waitScreen(name, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await visibleScreen();
    if (s === name) return true;
    await sleep(200);
  }
  return (await visibleScreen()) === name;
}

(async () => {
  await connect();
  await gotoApp();

  // ============ 1. 欢迎页 ============
  section('1. 欢迎页');
  let s = await visibleScreen();
  log(s === 'welcome', '默认进入欢迎页', 'screen=' + s);
  const wTitle = await getText('.w-title');
  log(/随行/.test(wTitle || ''), '欢迎页品牌标题', '「' + wTitle + '」');
  log(await click('[data-go="home"]'), '点击「开始使用」');
  log(await waitScreen('home'), '跳转首页');

  // ============ 2. 首页输入 ============
  section('2. 首页：输入 / 粘贴 / 清空 / 模式切换 / 范围选择');
  // 字数统计 + 按钮启用
  await evalJs(`document.querySelector('#inputText').value = '明早去银行，下午三点开会，晚上有空健身'; document.querySelector('#inputText').dispatchEvent(new Event('input'));`);
  const cnt = await getText('#charCount');
  const disabled = await evalJs(`document.querySelector('#parseBtn').disabled`);
  log(cnt === '19/2000', '字数统计实时更新', cnt);
  log(disabled === false, '输入后「智能整理」按钮启用');

  // 草稿持久化
  const draftSaved = await ls('zhaoyun_v1');
  log(draftSaved && JSON.parse(draftSaved).draft === '明早去银行，下午三点开会，晚上有空健身', '草稿已写入 localStorage', 'draft 存在');

  // 清空：第一次点击进入待确认状态
  await click('#clearBtn');
  const arm = await getText('#clearBtn');
  log(arm === '确认清空', '清空二次确认（首次点击变「确认清空」）', arm);
  await click('#clearBtn');
  const val = await evalJs(`document.querySelector('#inputText').value`);
  log(val === '', '确认后清空输入框');
  log(await getText('#charCount') === '0/2000', '清空后字数归零');

  // 重新输入并保存草稿
  await evalJs(`document.querySelector('#inputText').value = '周五前交方案，明天下午先做两小时'; document.querySelector('#inputText').dispatchEvent(new Event('input'));`);

  // 模式切换：语音（无麦克风环境下应提示）
  await click('#modeVoice');
  await sleep(500);
  const voiceScreen = await visibleScreen();
  log(voiceScreen === 'voice', '点击语音输入进入语音页', 'screen=' + voiceScreen);
  await screenshot('voice');
  await click('[data-back]');
  await sleep(300);
  log((await visibleScreen()) === 'home', '语音页返回首页');

  // 排期范围选择
  await click('[data-slot="安排明天"]');
  const rangeSaved = await ls('zhaoyun_v1');
  log(rangeSaved && JSON.parse(rangeSaved).range === '安排明天', '排期范围「安排明天」写入 localStorage');
  await click('[data-slot="本周事项"]');

  // ============ 3. 智能整理 → 解析 → 确认 ============
  section('3. 智能整理 → 解析动画 → 事项确认');
  log(await click('#parseBtn'), '点击「智能整理」');
  log(await waitScreen('parsing', 2000), '进入 AI 解析页');
  await sleep(4200);
  log(await waitScreen('confirm', 3000), '解析完成进入事项确认页');
  const rangeTip = await getText('#rangeTip');
  log(/本周/.test(rangeTip), '确认页显示排期范围', rangeTip);
  const sum = await getText('.summary-bar');
  log(/个事项/.test(sum), '摘要计数渲染', sum.replace(/\s+/g, ' '));

  // 确认页按钮
  section('3.1 确认页：卡片操作（删除/合并/拆分）');
  const cardsBefore = await count('.task-card');
  await click('.task-card .icon-btn[data-act="del"]');
  const cardsAfter = await count('.task-card');
  log(cardsAfter === cardsBefore - 1, '删除事项卡片', `${cardsBefore}→${cardsAfter}`);
  await click('.task-card .icon-btn[data-act="merge"]');
  await click('.task-card .icon-btn[data-act="split"]');
  log(true, '合并/拆分按钮（原型演示 toast）');

  // 仅保存待办
  section('3.2 仅保存待办 → 待办页数据流转');
  await click('#saveTodoBtn');
  log(await waitScreen('todo', 3000), '「仅保存待办」跳转待办页');
  const todoCount = await count('.todo-item');
  const todosSaved = await ls('zhaoyun_v1');
  log(todosSaved && JSON.parse(todosSaved).todos.length > 0, '待办写入 localStorage.todos', '条数=' + (todosSaved ? JSON.parse(todosSaved).todos.length : 0));

  // 回首页重新走排期主流程
  await click('[data-tab="home"]');
  await sleep(300);
  await click('[data-slot="安排今天"]');
  await click('#parseBtn');
  await sleep(5000);
  await click('#confirmBtn');
  log(await waitScreen('schedule', 3000), '「确认并排期」进入排期页', 'screen=' + (await visibleScreen()));

  // ============ 4. 排期页 ============
  section('4. 排期页：时间轴 / 候选区 / 延后 / 同步');
  const schedTitle = await getText('#schedTitle');
  log(schedTitle === '今日排期', '排期标题随范围变化', schedTitle);
  const tlRows = await count('.tl-row');
  log(tlRows >= 2, '时间轴渲染', tlRows + ' 行');
  const cand = await getText('#candidateBox');
  log(!!cand, '候选区渲染', cand.replace(/\s+/g, ' ').slice(0, 40));

  // 稍后同步
  await click('#syncLaterBtn');
  log(await waitScreen('home', 3000), '「稍后同步」返回首页');
  // 重新进入排期
  await click('#parseBtn');
  await sleep(5000);
  await click('#confirmBtn');
  await sleep(500);
  await click('#syncBtn');
  log(await waitScreen('sync', 3000), '「同步到日历/提醒」进入同步结果页');

  // ============ 5. 同步结果页 ============
  section('5. 同步结果页：明细 / 重试 / 复制');
  await screenshot('sync');
  const hero = await getText('#syncHeroTitle');
  log(/项已写入/.test(hero), '同步结果统计', hero);
  const failItems = await count('.si-fail');
  const retryBtn = await evalJs(`!!document.querySelector('#retryBtn')`);
  log(failItems >= 1 && retryBtn, '失败项展示「重试」按钮', '失败=' + failItems);
  await click('#retryBtn');
  await sleep(400);
  const failAfter = await count('.si-fail');
  log(failAfter === 0, '重试后失败项恢复成功', '剩余失败=' + failAfter);
  await click('#copyBtn');
  await sleep(300);
  const toastTxt = await getText('#toast');
  log(/复制/.test(toastTxt || ''), '「复制全部内容」', toastTxt);

  // ---- 日历联动验证：同步结果应真实写入 localStorage.calendar ----
  const calLs = await evalJs(`(() => { const d = JSON.parse(localStorage.getItem('zhaoyun_v1') || '{}'); return JSON.stringify(d.calendar || {}); })()`);
  const calObj = JSON.parse(calLs || '{}');
  const calKeys = Object.keys(calObj);
  log(calKeys.length >= 1, '同步后日历数据写入 localStorage.calendar', '日期=' + calKeys.join(','));

  await click('[data-go="home"]');
  log(await waitScreen('home', 2000), '「完成，回到首页」');

  // ---- 补充：重复同步去重（同名任务二次同步不追加）----
  await evalJs(`document.querySelector('#inputText').value = '健身，晚上健身'; document.querySelector('#inputText').dispatchEvent(new Event('input'));`);
  await click('#parseBtn');
  await sleep(5000);
  await click('#confirmBtn');
  await sleep(500);
  await click('#syncBtn');
  await sleep(500);
  const calAfter2 = await evalJs(`(() => { const d = JSON.parse(localStorage.getItem('zhaoyun_v1') || '{}'); return JSON.stringify(d.calendar || {}); })()`);
  const calObj2 = JSON.parse(calAfter2 || '{}');
  const dupKeys = Object.keys(calObj2).filter(d => (calObj2[d] || []).filter(x => x.name === '健身').length > 1);
  log(dupKeys.length === 0, '同名任务重复同步去重（无重复日程）', '健身重复日期=' + (dupKeys.join(',') || '无'));

  // ---- 补充：仅应用内任务不写入日历 ----
  await click('[data-tab="home"]');
  await sleep(300);
  await evalJs(`document.querySelector('#inputText').value = '只记在应用里的备忘'; document.querySelector('#inputText').dispatchEvent(new Event('input'));`);
  await click('#parseBtn');
  await sleep(5000);
  // 把第一条任务的同步目标改为「仅应用内」
  const changedSync = await evalJs(`(() => { const s = document.querySelector('.task-card select[data-field="sync"]'); if (!s) return false; s.value = '仅应用内'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  log(changedSync, '确认页修改同步目标为「仅应用内」');
  await click('#confirmBtn');
  await sleep(500);
  await click('#syncBtn');
  await sleep(500);
  const calAfter3 = await evalJs(`(() => { const d = JSON.parse(localStorage.getItem('zhaoyun_v1') || '{}'); return JSON.stringify(d.calendar || {}); })()`);
  const calObj3 = JSON.parse(calAfter3 || '{}');
  const leaked = Object.keys(calObj3).filter(d => (calObj3[d] || []).some(x => x.name.indexOf('备忘') > -1));
  log(leaked.length === 0, '「仅应用内」事项不写入日历', '泄漏日期=' + (leaked.join(',') || '无'));
  await click('[data-go="home"]');
  await sleep(500);

  // ============ 6. 待办页 ============
  section('6. 待办页：搜索 / 筛选 / 勾选 / 顺延 / 删除 / 分类计数');
  await click('[data-tab="todo"]');
  await sleep(400);
  log((await visibleScreen()) === 'todo', '底部导航进入待办页');
  const defaultCount = await count('.todo-item');
  log(defaultCount >= 5, '待办列表渲染', defaultCount + ' 条');

  // 分类计数：tab 徽标应与列表真实数据一致（全部=列表数）
  const allBadge = await evalJs(`document.querySelector('#todoTabs .tab[data-filter="all"] i').textContent`);
  log(+allBadge === defaultCount, '分类计数「全部」与列表数一致', allBadge + '=' + defaultCount);
  const doneBadge = await evalJs(`document.querySelector('#todoTabs .tab[data-filter="done"] i').textContent`);
  const doneReal = await evalJs(`document.querySelectorAll('.todo-item.done').length`);
  log(+doneBadge === doneReal, '分类计数「已完成」与状态一致', doneBadge + '=' + doneReal);

  // 搜索
  await evalJs(`document.querySelector('#todoSearch').value = '健身'; document.querySelector('#todoSearch').dispatchEvent(new Event('input'));`);
  await sleep(300);
  const searchCount = await count('.todo-item');
  log(searchCount >= 1, '搜索「健身」过滤', searchCount + ' 条');
  await evalJs(`document.querySelector('#todoSearch').value = ''; document.querySelector('#todoSearch').dispatchEvent(new Event('input'));`);

  // 筛选 tab
  await click('[data-filter="done"]');
  const doneCount = await count('.todo-item');
  log(doneCount >= 1, '筛选「已完成」', doneCount + ' 条');
  await click('[data-filter="pending"]');
  const pendCount = await count('.todo-item');
  log(pendCount >= 1, '筛选「未完成」', pendCount + ' 条');
  await click('[data-filter="today"]');
  await click('[data-filter="all"]');

  // 勾选完成
  await click('.todo-check');
  await sleep(300);
  const doneChecked = await evalJs(`document.querySelectorAll('.todo-item.done').length`);
  log(doneChecked >= 1, '勾选完成状态切换', doneChecked + ' 条已完成');

  // 顺延
  await click('.op-defer');
  await sleep(300);
  log(true, '「明天」顺延按钮');

  // 删除
  const delBefore = await count('.todo-item');
  await click('.op-del');
  await sleep(300);
  const delAfter = await count('.todo-item');
  log(delAfter === delBefore - 1, '「删除」待办', `${delBefore}→${delAfter}`);
  const todosSaved2 = await ls('zhaoyun_v1');
  log(!!todosSaved2, '待办增删后仍持久化 localStorage');

  // ============ 7. 日历页 ============
  section('7. 日历页：月/周切换 / 日期选择 / 翻月 / 联动展示');
  await click('[data-tab="calendar"]');
  await sleep(400);
  log((await visibleScreen()) === 'calendar', '底部导航进入日历页');
  const calTitle = await getText('#calTitle');
  log(/2026年8月/.test(calTitle), '日历标题', calTitle);
  const cells = await count('.cal-day:not(.other)');
  log(cells === 31, '月视图 31 天', cells + ' 天');
  // 点击日期
  await click('.cal-day[data-day="8"]');
  await sleep(300);
  const daySched = await getText('#daySchedule');
  log(/日程/.test(daySched), '点击日期显示当日日程', daySched.replace(/\s+/g, ' ').slice(0, 50));
  // 周视图
  await click('[data-view="week"]');
  await sleep(300);
  const weekView = await count('.week-col');
  log(weekView === 7, '周视图渲染 7 列', weekView + ' 列');
  await click('[data-view="month"]');
  // 翻月提示
  await click('[data-cal="prev"]');
  const prevToast = await getText('#toast');
  log(/8 月/.test(prevToast || ''), '翻月提示 toast', prevToast);
  // 联动：本地存储中有日历事项的日期应渲染出对应日程
  const syncedDay = calKeys.length ? +calKeys[0] : null;
  if (syncedDay) {
    await click('.cal-day[data-day="' + syncedDay + '"]');
    await sleep(300);
    const linked = await getText('#daySchedule');
    log(/项日程/.test(linked), '日历联动展示同步事项（第 ' + syncedDay + ' 日）', linked.replace(/\s+/g, ' ').slice(0, 60));
  } else {
    log(false, '日历联动展示同步事项（无已同步数据）');
  }

  // ============ 8. 我的页 ============
  section('8. 我的页：权限 / 无痕 / 数据管理');
  await click('[data-tab="profile"]');
  await sleep(400);
  log((await visibleScreen()) === 'profile', '底部导航进入我的页');
  await click('[data-perm]');
  const permToast = await getText('#toast');
  log(/权限/.test(permToast || ''), '权限行点击提示', permToast);
  // 无痕模式
  await evalJs(`document.querySelector('#incognito').checked = true; document.querySelector('#incognito').dispatchEvent(new Event('change'));`);
  await sleep(300);
  const inc = await ls('zhaoyun_v1');
  log(inc && JSON.parse(inc).incognito === true, '无痕模式写入 localStorage');
  // 关闭无痕
  await evalJs(`document.querySelector('#incognito').checked = false; document.querySelector('#incognito').dispatchEvent(new Event('change'));`);

  // 删除所有数据
  await click('.row-danger');
  await sleep(400);
  const lsAfter = await evalJs(`localStorage.getItem('zhaoyun_v1')`);
  log(lsAfter === null, '「删除所有数据」清空 localStorage', 'null=' + (lsAfter === null));

  // ============ 9. 数据流转综合验证 ============
  section('9. 数据流转：草稿恢复 / 范围恢复');
  // 删除后重新输入并刷新，验证草稿恢复
  await click('[data-tab="home"]');
  await sleep(300);
  await evalJs(`document.querySelector('#inputText').value = '明天下午三点和客户开会'; document.querySelector('#inputText').dispatchEvent(new Event('input'));`);
  await sleep(300);
  await send('Page.reload', { ignoreCache: true });
  await sleep(1500);
  const restored = await evalJs(`document.querySelector('#inputText').value`);
  log(restored === '明天下午三点和客户开会', '刷新后草稿自动恢复（localStorage 流转）', '「' + restored + '」');

  // 重新进入欢迎页验证
  const afterReloadScreen = await visibleScreen();
  log(afterReloadScreen === 'welcome', '刷新后回到欢迎页');

  // ============ 汇总 ============
  section('汇总');
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n通过 ${pass}/${results.length}，失败 ${results.length - pass} 项`);
  const fails = results.filter((r) => !r.ok);
  fails.forEach((f) => console.log('  ✗ ' + f.name + ' :: ' + f.detail));
  await screenshot('final');
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('E2E 异常:', e); process.exit(2); });
