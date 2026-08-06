/* ========== 巢雲随行 · 移动端原型 交互逻辑 ========== */
(function () {
  'use strict';

  /* ---------- 基础工具 ---------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  /* ---------- 真实系统日期基准（不再硬编码 2026/8/5） ---------- */
  const TODAY = new Date();
  const CAL_YEAR = TODAY.getFullYear();
  const CAL_MONTH = TODAY.getMonth();
  const TODAY_DAY = TODAY.getDate();
  const TODAY_WD = TODAY.getDay(); // 0=周日
  const WD_CN = ['日', '一', '二', '三', '四', '五', '六'];
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  /* 超出当前月份（跨月）则视为无效日，不落日历，避免显示错乱 */
  function clampDay(d) { const max = daysInMonth(CAL_YEAR, CAL_MONTH); return d >= 1 && d <= max ? d : null; }

  /* HTML 转义：LLM 输出/用户输入均为不受信数据，渲染前统一转义防注入 */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- 本地持久化（localStorage：刷新/关闭后数据不丢失） ---------- */
  const LS_KEY = 'zhaoyun_v1';
  function loadData() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveData(patch) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(loadData(), patch))); } catch (e) {}
  }
  function isIncognito() {
    return !!loadData().incognito;
  }

  /* ---------- 屏幕导航 ---------- */
  function stopVoice() {
    try { if (currentRec) { currentRec.stop(); } } catch (e) {}
    clearInterval(voiceTimer);
  }
  function showScreen(name) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
    const tabScreens = ['home', 'todo', 'calendar', 'profile'];
    $('#tabbar').classList.toggle('hidden', !tabScreens.includes(name));
    $$('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $('.app').scrollTop = 0;
    /* 离开语音页时停止麦克风与计时器（隐私红线：不能后台偷偷录音） */
    if (name !== 'voice') stopVoice();
    /* 返回首页时重置为文字输入模式高亮（修复：从语音页返回后“语音输入”仍显示选中态的错位） */
    if (name === 'home') {
      const mt = $('#modeText'), mv = $('#modeVoice');
      if (mt && mv) { mt.classList.add('active'); mv.classList.remove('active'); }
    }
  }

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) showScreen(go.dataset.go);
    const back = e.target.closest('[data-back]');
    if (back) showScreen('home');
  });

  $$('.tab-item').forEach(b => b.addEventListener('click', () => showScreen(b.dataset.tab)));

  /* ---------- 状态栏时间 ---------- */
  function tickClock() {
    const now = new Date();
    $('#sbTime').textContent = now.toTimeString().slice(0, 5);
  }
  tickClock();
  setInterval(tickClock, 30000);

  /* 问候语（PRD 9.1：05-11 早安 / 12-17 下午好 / 18-04 晚上好，设计稿文案） */
  function setGreeting() {
    const h = new Date().getHours();
    const g = h >= 5 && h < 12 ? '早安' : (h >= 12 && h < 18 ? '下午好' : '晚上好');
    $('#hGreet').textContent = g + '，';
  }
  setGreeting();

  /* ---------- 首页输入（按设计稿 v2） ---------- */
  const input = $('#inputText');
  const parseBtn = $('#parseBtn');
  const charCount = $('#charCount');

  function syncInput() {
    const n = input.value.length;
    charCount.textContent = n + '/2000';
    parseBtn.disabled = !input.value.trim();
  }

  input.addEventListener('input', () => {
    syncInput();
    if (!isIncognito()) saveData({ draft: input.value });
  });
  syncInput();
  /* 草稿自动恢复（PRD 9.2） */
  if (!isIncognito() && loadData().draft) {
    input.value = loadData().draft;
    syncInput();
  }

  /* 输入方式切换：文字输入 / 语音输入 */
  $('#modeText').addEventListener('click', () => {
    $('#modeText').classList.add('active');
    $('#modeVoice').classList.remove('active');
    input.focus();
  });
  $('#modeVoice').addEventListener('click', () => {
    $('#modeVoice').classList.add('active');
    $('#modeText').classList.remove('active');
    startVoice();
  });

  /* 粘贴内容 */
  $('#pasteBtn').addEventListener('click', () => {
    const doPaste = (txt) => {
      if (!txt || !txt.trim()) { toast('剪贴板为空，请先复制内容'); return; }
      input.value = (input.value ? input.value + '\n' : '') + txt.slice(0, 2000);
      syncInput();
      toast('已粘贴内容，可直接智能整理');
    };
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(doPaste).catch(() => toast('无法读取剪贴板，请长按输入框粘贴'));
    } else {
      toast('请长按输入框，选择「粘贴」');
    }
  });

  /* 清空（二次确认，PRD 9.2） */
  let clearArm = false;
  $('#clearBtn').addEventListener('click', () => {
    if (!input.value.trim()) { toast('当前没有内容'); return; }
    if (!clearArm) {
      clearArm = true;
      $('#clearBtn').textContent = '确认清空';
      $('#clearBtn').style.color = 'var(--danger)';
      setTimeout(() => { $('#clearBtn').textContent = '清空'; $('#clearBtn').style.color = ''; clearArm = false; }, 2500);
      return;
    }
    input.value = '';
    $('#clearBtn').textContent = '清空';
    $('#clearBtn').style.color = '';
    clearArm = false;
    syncInput();
    toast('已清空');
  });

  /* 快捷入口：排期范围选择器（只影响解析范围，不修改用户原文，PRD 9.2） */
  let rangeSlot = loadData().range || '安排今天';
  const rangeHints = {
    '安排今天': '已选择【今天】：输入的内容会安排到今天的日程',
    '安排明天': '已选择【明天】：输入的内容会安排到明天的日程',
    '本周事项': '已选择【本周】：输入的内容会归入本周统一排期',
    '只拆分待办': '已选择【只拆分待办】：只拆成待办清单，不生成日程'
  };
  const rangeLabels = {
    '安排今天': '今天',
    '安排明天': '明天',
    '本周事项': '本周',
    '只拆分待办': '仅待办（不排期）'
  };
  $$('.h2-q-item').forEach(c => c.addEventListener('click', () => {
    rangeSlot = c.dataset.slot;
    $$('.h2-q-item').forEach(x => x.classList.toggle('selected', x === c));
    saveData({ range: rangeSlot });
    toast(rangeHints[rangeSlot]);
  }));
  $$('.h2-q-item').forEach(c => c.classList.toggle('selected', c.dataset.slot === rangeSlot));

  /* ---------- 语音页（真实 Web Speech API 识别） ---------- */
  let voiceTimer = null, voiceSec = 0;
  let currentRec = null, voiceFinal = '';
  const voiceTranscript = $('#voiceTranscript');

  function startVoice() {
    showScreen('voice');
    voiceSec = 0; voiceFinal = '';
    $('#voiceDur').textContent = '00:00';
    voiceTranscript.textContent = '正在聆听…请对着手机说话，例如「明早去银行，下午三点开会」';
    clearInterval(voiceTimer);
    voiceTimer = setInterval(() => {
      voiceSec++;
      $('#voiceDur').textContent = String(Math.floor(voiceSec / 60)).padStart(2, '0') + ':' + String(voiceSec % 60).padStart(2, '0');
    }, 1000);

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      voiceTranscript.textContent = '当前浏览器不支持语音识别，请使用 Chrome / Edge / 安卓浏览器，或改用文字输入';
      return;
    }
    if (currentRec) { try { currentRec.abort(); } catch (e) {} }
    const rec = new SR();
    currentRec = rec;
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let finalTxt = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTxt += r[0].transcript; else interim += r[0].transcript;
      }
      if (finalTxt) voiceFinal += finalTxt;
      const show = (voiceFinal || interim).trim();
      if (show) voiceTranscript.textContent = show;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        voiceTranscript.textContent = '未获得麦克风权限，请在浏览器地址栏允许麦克风后重试';
      } else if (e.error === 'no-speech') {
        voiceTranscript.textContent = '没有听到声音，请靠近麦克风再说一次';
      } else if (e.error !== 'aborted') {
        voiceTranscript.textContent = '识别出错（' + e.error + '），可点重录或改用文字输入';
      }
    };
    try { rec.start(); } catch (e) {}
  }

  $('#reRecordBtn').addEventListener('click', () => {
    toast('已重新开始录音');
    startVoice();
  });

  $('#voiceDoneBtn').addEventListener('click', () => {
    stopVoice();
    /* 只采用真实识别文本；识别失败/未听到时 voiceFinal 为空，绝不把提示文案当输入 */
    const txt = (voiceFinal || '').trim();
    if (!txt) {
      toast('没有识别到内容，请重试或改用文字输入');
      showScreen('home');
      return;
    }
    input.value = txt;
    syncInput();
    startParsing();
  });

  /* ---------- 解析动画 ---------- */
  /* LLM 精准拆解：优先经本地代理 /api/parse，失败/超时回退规则引擎 */
  async function tryLLMParse(text) {
    if (!text || !text.trim()) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, todayHint: '今天是 ' + new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0') } ),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!resp.ok) return null; // 未配置 key / 上游失败 → 回退
      const data = await resp.json();
      if (!data.tasks || !data.tasks.length) return null;
      return data.tasks;
    } catch (e) { return null; }
  }

  /* 范围选择器真正生效：把用户选择的"本次安排到"应用到拆解结果 */
  function applyRangeSlot(list) {
    if (!list || !list.length) return;
    if (rangeSlot === '安排今天' || rangeSlot === '安排明天') {
      const base = new Date(TODAY);
      if (rangeSlot === '安排明天') base.setDate(TODAY_DAY + 1);
      const ds = (base.getMonth() + 1) + '月' + base.getDate() + '日（周' + WD_CN[base.getDay()] + '）';
      list.forEach(t => {
        t.date = ds; // 强制覆盖为所选日期，不受原文是否含"明天"等词影响
        if (t.pending.indexOf('时间') === -1 && (!t.start || t.start === '待确认')) t.start = '';
      });
    } else if (rangeSlot === '只拆分待办') {
      list.forEach(t => { t.sync = '仅应用内'; }); // 不生成日程，只进待办
    }
    // 本周事项：保留文本识别出的日期（自然落在当周），不强改
  }

  function startParsing() {
    showScreen('parsing');
    $$('.parsing-steps li').forEach(li => li.classList.remove('done'));
    $('#parsingTitle').textContent = '正在理解你的话…';
    const steps = ['#ps1', '#ps2', '#ps3'];
    steps.forEach((id, i) => {
      setTimeout(() => {
        $(id).classList.add('done');
        if (id === '#ps1') $('#parsingTitle').textContent = '正在拆分事项…';
        if (id === '#ps2') $('#parsingTitle').textContent = '正在检查冲突…';
      }, 1100 * (i + 1));
    });
    const llmPromise = tryLLMParse(input.value);
    setTimeout(async () => {
      const llmTasks = await llmPromise;
      if (llmTasks) {
        tasks = llmTasks;
      } else {
        tasks = parseByRules(input.value);
        if (!tasks.length) { tasks = fallbackTasks(); toast('未能从输入中识别到任务，已展示示例'); }
      }
      applyRangeSlot(tasks); // 让首页选择的"本次安排到"真正生效
      // 无痕模式：解析完成后删除原文（PRD 12.2）
      if (isIncognito()) { input.value = ''; syncInput(); }
      renderConfirm();
      showScreen('confirm');
    }, 3900);
  }

  parseBtn.addEventListener('click', startParsing);

  /* ==================================================
     规则拆解引擎（免 key 版：真实转写 → 基础结构化）
     覆盖：日期/时段/具体时间/时长/优先级/提醒/依赖
  ================================================== */
  const CN_NUM = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 };

  function parseByRules(text) {
    if (!text || !text.trim()) return [];
    const now = new Date();
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const fmtDate = (d) => (d.getMonth() + 1) + '月' + d.getDate() + '日（周' + days[d.getDay()] + '）';

    /* 日期偏移 */
    function dateOffset(s) {
      if (/后天/.test(s)) return 2;
      if (/明天|明早|明晚|明日/.test(s)) return 1;
      if (/今天|今晚|现在/.test(s)) return 0;
      const wd = s.match(/周([一二三四五六日天])|星期([一二三四五六日天])/);
      if (wd) {
        const target = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 }[wd[1] || wd[2]];
        let off = (target - now.getDay() + 7) % 7;
        return off === 0 ? 7 : off;
      }
      if (/周末/.test(s)) { const off = (6 - now.getDay() + 7) % 7; return off === 0 ? 7 : off; }
      return null;
    }
    /* 模糊时段 → 建议时间（PRD：必须标记待确认） */
    function slotTime(s) {
      if (/明早|清晨|早上|早晨|上午/.test(s)) return '08:30';
      if (/中午/.test(s)) return '12:30';
      if (/下午/.test(s)) return '15:00';
      if (/傍晚/.test(s)) return '18:00';
      if (/晚上|今晚|明晚/.test(s)) return '19:30';
      if (/晚点|稍后|待会|回头/.test(s)) return '19:30';
      return null;
    }
    /* 具体时间：三点 / 3点 / 三点半 / 15:30 / 下午三点 */
    function clockTime(s) {
      let m = s.match(/(上午|中午|下午|晚上)?\s*([0-9]{1,2})[:：]([0-9]{2})/);
      if (m) {
        let h = +m[2], min = +m[3];
        if ((m[1] === '下午' || m[1] === '晚上') && h < 12) h += 12;
        if (m[1] === '中午' && h < 12) h += 12;
        return { t: String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0'), fixed: true };
      }
      m = s.match(/(上午|中午|下午|晚上)?\s*([0-9一二三四五六七八九十两]+)\s*点(?:半|钟)?(?:\s*([0-9一二三四五六七八九十]+)\s*分)?/);
      if (m) {
        let h = /^\d+$/.test(m[2]) ? +m[2] : CN_NUM[m[2]];
        if (h === undefined || h === null) return null;
        let min = 0;
        if (/点半|点30/.test(m[0])) min = 30;
        if (m[3]) min = /^\d+$/.test(m[3]) ? +m[3] : (CN_NUM[m[3]] || 0);
        if ((m[1] === '下午' || m[1] === '晚上') && h < 12) h += 12;
        if (m[1] === '中午' && h < 12) h += 12;
        return { t: String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0'), fixed: !!m[1] };
      }
      return null;
    }
    /* 时长 */
    function duration(s) {
      if (/半小时/.test(s)) return 30;
      const m = s.match(/([0-9一二三四五六七八九十两]+)\s*(小时|个?小时|分钟)/);
      if (!m) return null;
      let n = /^\d+$/.test(m[1]) ? +m[1] : CN_NUM[m[1]];
      if (n === undefined || n === null) return null;
      return m[2].indexOf('分钟') > -1 ? Math.round(n) : Math.round(n * 60);
    }
    /* 优先级 */
    function priority(s) {
      if (/重要|紧急|必须|赶紧|尽快|马上|优先|别忘了/.test(s)) return 'high';
      if (/有空|随便|不急|抽空|顺便/.test(s)) return 'low';
      return 'medium';
    }
    /* 标题清洗 */
    function cleanTitle(seg) {
      let t = seg;
      t = t.replace(/(今天|明天|后天|明早|明晚|昨日|上午|中午|下午|晚上|傍晚|清晨|早上|早晨|周末|周[一二三四五六日天]|星期[一二三四五六日天]|晚点|稍后|待会|回头)/g, ' ');
      t = t.replace(/[0-9一二三四五六七八九十两]+\s*点(?:半|钟)?(?:\s*[0-9一二三四五六七八九十]+\s*分)?/g, ' ');
      t = t.replace(/[0-9一二三四五六七八九十两]+\s*小时|[0-9一二三四五六七八九十两]+\s*分钟|半小时/g, ' ');
      t = t.trim();
      t = t.replace(/^(记得|帮我|我要|我想|需要|要|请|麻烦|别忘了|务必|有?空|前(交|要))/g, ' ');
      t = t.trim();
      return t;
    }

    /* 切分：标点 + 连接词 */
    const segments = text.split(/[，。！？；、\n]+|然后|接着|再|之后|以及|还有|顺便|别忘了|帮我/g)
      .map(s => s.trim()).filter(Boolean);

    const out = [];
    segments.forEach((seg, i) => {
      const off = dateOffset(seg);
      const clk = clockTime(seg);
      const slot = slotTime(seg);
      const dur = duration(seg);
      const pri = priority(seg);
      const title = cleanTitle(seg) || ('待办事项 ' + (i + 1));

      let type = 'flexible', typeLabel = '弹性任务';
      const pending = [];
      let start = '', end = '';

      if (clk) { type = 'fixed'; typeLabel = '固定事项'; start = clk.t; }
      else if (slot) { start = slot; pending.push('时间'); }
      if (/提醒|别忘了|记得/.test(seg) && !clk) { type = 'reminder'; typeLabel = '提醒事项'; }
      if (/前交|之前交|截止|交到|前要/.test(seg)) { type = 'flexible'; typeLabel = '弹性任务'; if (pending.indexOf('时间') === -1) pending.push('时间'); }
      if (dur === null && type === 'flexible' && pending.indexOf('时长') === -1) pending.push('时长');

      const d = new Date(now);
      if (off !== null) d.setDate(now.getDate() + off);

      out.push({
        id: Date.now() + i, title, type, typeLabel,
        ai: false, src: 'rule',
        date: fmtDate(d),
        start: start || (pending.indexOf('时间') > -1 ? '待确认' : ''),
        end: end,
        dur: dur ? dur + ' 分钟' : '待确认',
        pri: pri,
        sync: type === 'fixed' ? '系统日历' : '提醒事项',
        pending: pending, conf: 0.85, conflict: false
      });
    });
    return out;
  }

  /* 兜底示例（规则未命中时展示，保持演示可走通） */
  function fallbackTasks() {
    return [
      { id: 1, title: '去银行办业务', type: 'fixed', typeLabel: '固定事项', ai: true, src: 'ai', date: '明天', start: '08:30', end: '09:30', dur: '60 分钟', pri: 'medium', sync: '系统日历', pending: [], conf: 0.96 },
      { id: 2, title: '和客户开产品会', type: 'fixed', typeLabel: '固定事项', ai: true, src: 'ai', date: '明天', start: '15:00', end: '16:00', dur: '60 分钟', pri: 'high', sync: '系统日历', pending: [], conf: 0.98 },
      { id: 3, title: '健身', type: 'flexible', typeLabel: '弹性任务', ai: true, src: 'ai', date: '明天', start: '待确认', end: '', dur: '60 分钟', pri: 'low', sync: '提醒事项', pending: ['时间'], conf: 0.72 },
      { id: 4, title: '准备周五要交的方案', type: 'flexible', typeLabel: '弹性任务', ai: true, src: 'ai', date: '明天', start: '待确认', end: '', dur: '120 分钟', pri: 'high', sync: '系统日历', pending: ['时间', '时长'], conf: 0.81, conflict: true }
    ];
  }

  /* ==================================================
     确认页：任务数据
  ================================================== */
  let tasks = [];

  function renderConfirm() {
    const box = $('#taskCards');
    $('#rangeTip').textContent = '排期范围：' + rangeLabels[rangeSlot];
    box.innerHTML = tasks.map(t => `
      <div class="card task-card" data-id="${t.id}">
        <div class="tc-top">
          <span class="tc-type ${t.type}">${escapeHtml(t.typeLabel)}</span>
          ${t.src === 'rule' ? '<span class="tc-ai">自动识别</span>' : t.src === 'llm' ? '<span class="tc-ai" style="border-color:var(--gold,#C9A063);color:#B08D57">AI 精准拆解</span>' : t.ai ? '<span class="tc-ai">AI 建议</span>' : ''}
          ${t.conflict ? '<span class="tc-ai" style="border-color:var(--danger);color:var(--danger)">时间冲突</span>' : ''}
        </div>
        <input class="tc-title-input" data-field="title" value="${escapeHtml(t.title)}">
        <div class="tc-fields">
          <div class="tc-field">
            <span class="fl">📅 日期</span>
            ${t.pending.indexOf('时间') > -1 ? '<span class="tc-pending">待确认</span>' : `<span class="tc-val">${escapeHtml(t.date || '今天')}</span>`}
          </div>
          <div class="tc-field">
            <span class="fl">🕐 时间</span>
            ${t.pending.indexOf('时间') > -1
              ? `<button class="tc-pending tc-edit" data-edit="start" data-id="${t.id}">待确认${t.start && t.start !== '待确认' ? ' · 建议 ' + escapeHtml(t.start) : ''} · 点此设置</button>`
              : `<span class="tc-val">${escapeHtml(t.start || '—')}${t.end ? ' - ' + escapeHtml(t.end) : ''}</span>`}
          </div>
          <div class="tc-field">
            <span class="fl">⏱ 时长</span>
            ${t.pending.indexOf('时长') > -1
              ? `<button class="tc-pending tc-edit" data-edit="dur" data-id="${t.id}">待确认${t.dur && t.dur !== '待确认' ? ' · 建议 ' + escapeHtml(t.dur) : ''} · 点此设置</button>`
              : `<span class="tc-val">${escapeHtml(t.dur || '—')}</span>`}
          </div>
          <div class="tc-field">
            <span class="fl">⚑ 优先级</span>
            <select data-field="pri">
              <option value="high" ${t.pri === 'high' ? 'selected' : ''}>高</option>
              <option value="medium" ${t.pri === 'medium' ? 'selected' : ''}>中</option>
              <option value="low" ${t.pri === 'low' ? 'selected' : ''}>低</option>
            </select>
          </div>
          <div class="tc-field">
            <span class="fl">🔗 同步到</span>
            <select data-field="sync">
              <option value="系统日历" ${t.sync === '系统日历' ? 'selected' : ''}>系统日历</option>
              <option value="提醒事项" ${t.sync === '提醒事项' ? 'selected' : ''}>提醒事项</option>
              <option value="仅应用内" ${t.sync === '仅应用内' ? 'selected' : ''}>仅应用内</option>
            </select>
          </div>
        </div>
        <div class="tc-actions">
          <button class="icon-btn" data-act="merge" title="合并">⇄</button>
          <button class="icon-btn" data-act="split" title="拆分">⧉</button>
          <span class="spacer"></span>
          <button class="icon-btn" data-act="del" title="删除" style="color:var(--danger)">🗑</button>
        </div>
      </div>`).join('');

    $('#sumCount').textContent = tasks.length;
    $('#sumPending').textContent = tasks.filter(t => t.pending.length).length;
    $('#sumConflict').textContent = tasks.filter(t => t.conflict).length;
  }

  /* 确认页卡片操作 */
  $('#taskCards').addEventListener('click', (e) => {
    const card = e.target.closest('.task-card');
    if (!card) return;
    /* 待确认字段：点击设置具体时间 / 时长，闭合人机确认闭环 */
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const t = tasks.find(x => x.id === +edit.dataset.id);
      if (!t) return;
      if (edit.dataset.edit === 'start') {
        const v = prompt('设置具体时间（格式 小时:分钟，如 14:30）', (t.start && t.start !== '待确认') ? t.start : '');
        if (v == null) return;
        const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (m && +m[1] >= 0 && +m[1] < 24) {
          t.start = m[1].padStart(2, '0') + ':' + m[2];
          t.pending = t.pending.filter(p => p !== '时间');
          renderConfirm();
          toast('已设置时间 ' + t.start);
        } else toast('格式不正确，请用 HH:MM');
      } else if (edit.dataset.edit === 'dur') {
        const v = prompt('设置时长（分钟，如 60）', (t.dur && t.dur !== '待确认') ? parseInt(t.dur, 10) : '');
        if (v == null) return;
        if (/^\d+$/.test(v.trim()) && +v.trim() > 0) {
          t.dur = v.trim() + ' 分钟';
          t.pending = t.pending.filter(p => p !== '时长');
          renderConfirm();
          toast('已设置时长 ' + t.dur);
        } else toast('请输入大于 0 的数字（分钟）');
      }
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const id = +card.dataset.id;
    if (act.dataset.act === 'del') {
      tasks = tasks.filter(t => t.id !== id);
      renderConfirm();
      toast('已删除该事项');
    } else if (act.dataset.act === 'split') {
      const idx = tasks.findIndex(t => t.id === id);
      if (idx < 0) return;
      const src = tasks[idx];
      const copy = Object.assign({}, src, {
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title: src.title + '（拆分）', conflict: false, pending: src.pending.slice()
      });
      tasks.splice(idx + 1, 0, copy);
      renderConfirm();
      toast('已拆分为独立子项，可分别设置时间');
    } else if (act.dataset.act === 'merge') {
      const idx = tasks.findIndex(t => t.id === id);
      if (idx < 0 || idx >= tasks.length - 1) { toast('已是最后一项，无可合并'); return; }
      const a = tasks[idx], b = tasks[idx + 1];
      const order = { high: 3, medium: 2, low: 1 };
      a.title = a.title + ' + ' + b.title;
      a.pri = order[a.pri] >= order[b.pri] ? a.pri : b.pri;
      a.conflict = !!(a.conflict || b.conflict);
      tasks.splice(idx + 1, 1);
      renderConfirm();
      toast('已合并相邻事项');
    }
  });

  $('#taskCards').addEventListener('change', (e) => {
    if (!e.target.dataset.field) return;
    const card = e.target.closest('.task-card');
    if (!card) return;
    const id = +card.dataset.id;
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    const field = e.target.dataset.field;
    if (field === 'pri') t.pri = e.target.value;
    else if (field === 'title') t.title = e.target.value;
    else if (field === 'sync') {
      if (t._origTypeLabel === undefined) t._origTypeLabel = t.typeLabel;
      t.sync = e.target.value;
      t.typeLabel = e.target.value === '仅应用内' ? '应用内事项' : t._origTypeLabel;
    }
    toast('字段已更新：' + (field === 'pri' ? '优先级 → ' + e.target.value
      : field === 'title' ? '标题已修改'
      : '同步目标 → ' + e.target.value));
  });

  /* 仅保存待办 */
  $('#saveTodoBtn').addEventListener('click', () => {
    toast('已保存到应用内待办');
    seedTodoFromTasks();
    setTimeout(() => showScreen('todo'), 500);
  });

  function seedTodoFromTasks() {
    tasks.forEach(t => {
      if (!todoItems.find(x => x.name === t.title)) {
        const day = taskDayNum(t);
        const tomorrow = clampDay(TODAY_DAY + 1);
        const rel = day === TODAY_DAY ? '今天' : day === tomorrow ? '明天' : (t.date || '待定');
        todoItems.unshift({
          name: t.title, meta: rel + ' · ' + t.typeLabel,
          pri: t.pri, done: false, src: 'AI 拆分', taskId: t.id
        });
      }
    });
    renderTodo();
    saveTodos();
  }

  /* 确认并排期 */
  $('#confirmBtn').addEventListener('click', () => {
    renderSchedule();
    showScreen('schedule');
  });

  /* ==================================================
     排期页
  ================================================== */
  function renderSchedule() {
    /* 按所选范围更新标题与日期（原型固定演示 2026 年 8 月） */
    const schedTitles = { '安排今天': '今日排期', '安排明天': '明日排期', '本周事项': '本周排期', '只拆分待办': '待办清单' };
    $('#schedTitle').textContent = schedTitles[rangeSlot];
    const fmt = (d) => (d.getMonth() + 1) + '月' + d.getDate() + '日 · 星期' + WD_CN[d.getDay()];
    /* 排期页日期基于真实系统日期，不再硬编码 2026/8/5 */
    if (rangeSlot === '本周事项') {
      const monOff = (TODAY_WD + 6) % 7; // 距本周一已过天数（周一为周起点）
      const mon = new Date(CAL_YEAR, CAL_MONTH, clampDay(TODAY_DAY - monOff) || TODAY_DAY);
      const sun = new Date(CAL_YEAR, CAL_MONTH, clampDay(TODAY_DAY + (6 - monOff)) || TODAY_DAY);
      $('.schedule-date').textContent = (mon.getMonth() + 1) + '月' + mon.getDate() + '日 - ' + (sun.getMonth() + 1) + '月' + sun.getDate() + '日 · 本周';
    } else if (rangeSlot === '只拆分待办') {
      $('.schedule-date').textContent = '仅待办 · 不生成日程';
    } else {
      const target = rangeSlot === '安排明天' ? (clampDay(TODAY_DAY + 1) || TODAY_DAY) : TODAY_DAY;
      $('.schedule-date').textContent = fmt(new Date(CAL_YEAR, CAL_MONTH, target));
    }

    /* 时间轴：有时间的按时间升序，待排的置底；午休固定 12:00 插入正确位置 */
    const withTime = tasks.filter(t => t.start && t.start !== '待确认')
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(t => ({ time: t.start, cls: t.type === 'fixed' ? 'fixed' : t.type === 'flexible' ? 'flex' : 'reminder', title: t.title, sub: t.typeLabel + ' · ' + t.sync + (t.pending.length ? ' · 待确认' : '') }));
    const noTime = tasks.filter(t => !(t.start && t.start !== '待确认'))
      .map(t => ({ time: '待排', cls: 'flex', title: t.title, sub: t.typeLabel + ' · ' + t.sync + ' · 待确认' }));
    const lunch = { time: '12:00', cls: 'fixed', title: '午休', sub: '固定时段' };
    const timeline = withTime.slice();
    const li = timeline.findIndex(x => x.time > '12:00');
    if (li === -1) timeline.push(lunch); else timeline.splice(li, 0, lunch);
    timeline.push(...noTime);
    $('#timeline').innerHTML = timeline.map(it => `
      <div class="tl-row">
        <span class="tl-time">${escapeHtml(it.time)}</span>
        <div class="tl-bar"><span class="tl-dot ${it.cls === 'flex' ? 'flex' : it.cls === 'adj' ? 'adj' : ''}"></span></div>
        <div class="tl-body"><div class="tl-item ${it.cls}"><b>${escapeHtml(it.title)}</b><span class="tl-sub">${escapeHtml(it.sub)}</span></div></div>
      </div>`).join('');

    const cand = $('#candidateBox');
    const pendingCount = tasks.filter(t => t.pending.length).length;
    cand.innerHTML = pendingCount
      ? `<h3>候选区</h3><div class="cand-item" style="border-top:none;padding-top:0">有 ${pendingCount} 项时间/时长待确认，确认后自动排入时间轴</div>`
      : `<h3>候选区</h3><div class="cand-item" style="border-top:none;padding-top:0;color:var(--ok)">✅ 事项已全部安排，保留 20% 空闲容量</div>`;
  }

  $('#syncLaterBtn').addEventListener('click', () => {
    toast('已保存到应用内排期，可稍后同步');
    setTimeout(() => showScreen('home'), 600);
  });

  $('#syncBtn').addEventListener('click', () => {
    // 真正写入日历数据（localStorage.calendar），供日历页联动展示
    const calPatch = {};
    const seen = new Set();
    tasks.forEach(t => {
      if (t.sync === '仅应用内') return; // 仅应用内事项不落日历
      const day = taskDayNum(t);
      if (day === null) return;
      const key = 't' + t.id; // 用任务 id 去重，而非名称（避免同名演示事项吞掉真实数据）
      if (seen.has(key)) return;
      seen.add(key);
      calPatch[day] = calPatch[day] || [];
      const time = (t.start && t.start !== '待确认') ? t.start : '—';
      calPatch[day].push({ id: key, name: t.title, time, synced: t.sync === '系统日历' });
    });
    saveCalendar(calPatch); // 演示数据不参与；saveCalendar 按 id 幂等合并，不丢失既有数据
    seedTodoFromTasks(); // 同步排期的同时把事项同步进应用内待办，保证待办↔日历双向一致
    renderSync();
    showScreen('sync');
  });

  /* ==================================================
     同步结果页
  ================================================== */
  function removeCalEventById(id) {
    if (id == null) return;
    const cur = loadCalendar();
    let changed = false;
    const key = 't' + id;
    Object.keys(cur).forEach(d => {
      const before = cur[d].length;
      cur[d] = cur[d].filter(x => !(x.id && x.id === key));
      if (cur[d].length !== before) changed = true;
    });
    if (changed) saveData({ calendar: cur });
  }
  /* 待办完成状态 → 同步到日历事件，保证双向视图一致 */
  function updateCalEventDone(id, done) {
    if (id == null) return;
    const cur = loadCalendar();
    const key = 't' + id;
    let changed = false;
    Object.keys(cur).forEach(d => {
      cur[d].forEach(ev => { if (ev.id && ev.id === key) { ev.done = done; changed = true; } });
    });
    if (changed) saveData({ calendar: cur });
  }

  function renderSync() {
    const items = tasks.map((t) => ({
      icon: t.sync === '系统日历' ? '📅' : '🔔',
      ok: true, // 本地写入必然成功，不再伪造失败状态
      name: t.title,
      sub: t.start && t.start !== '待确认'
        ? (t.sync === '系统日历' ? '已写入系统日历 · ' : t.sync === '提醒事项' ? '已写入提醒事项 · ' : '已保存到应用内待办 · ') + (t.date || '') + ' ' + t.start
        : (t.sync === '仅应用内' ? '已保存到应用内待办' : '时间待确认，已保存到应用内待办')
    }));
    $('#syncList').innerHTML = items.map(it => `
      <div class="sync-item">
        <span class="si-icon si-ok">✓</span>
        <div><div class="si-name">${escapeHtml(it.name)}</div><div class="si-sub">${escapeHtml(it.sub)}</div></div>
      </div>`).join('');

    const okCount = items.length;
    const cal = items.filter(i => i.icon === '📅').length;
    const rem = items.filter(i => i.icon === '🔔').length;
    $('#syncHeroTitle').textContent = okCount + ' 项已写入系统';
    const stat = (cal ? '日历 ' + cal + ' 项' : '') + (cal && rem ? ' · ' : '') + (rem ? '提醒事项 ' + rem + ' 项' : '');
    $('#syncStat').textContent = stat || '已保存到应用内待办';
  }

  /* 复制兜底 */
  $('#copyBtn').addEventListener('click', () => {
    const text = '巢雲随行 · 待办清单\n' + tasks.map((t, i) =>
      (i + 1) + '. ' + t.title + (t.start && t.start !== '待确认' ? '（' + (t.date || '') + ' ' + t.start + '）' : '（时间待确认）')
    ).join('\n');
    const done = () => toast('已复制，可粘贴到备忘录');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动复制'); }
      document.body.removeChild(ta);
    }
  });

  /* ==================================================
     待办页
  ================================================== */
  /* 待办数据：优先从本地存储恢复，首次使用给演示数据 */
  const defaultTodos = [
    { name: '整理方案初稿', meta: '今天 14:00 · 弹性任务', pri: 'medium', done: false, src: '今日安排' },
    { name: '联系设计师确认海报', meta: '明天 · 待办', pri: 'high', done: false, src: '语音输入' },
    { name: '健身', meta: '今晚 19:00 · AI 建议', pri: 'low', done: false, src: '语音输入' },
    { name: '买咖啡豆', meta: '本周末 · 待办', pri: 'low', done: false, src: '手写输入' },
    { name: '产品评审会', meta: '今天 09:30 · 已完成', pri: 'high', done: true, src: '今日安排' },
    { name: '整理周报', meta: '昨天 · 已完成', pri: 'medium', done: true, src: '手写输入' }
  ];
  let todoItems = (loadData().todos && loadData().todos.length) ? loadData().todos : defaultTodos.slice();
  function saveTodos() { saveData({ todos: todoItems }); }

  let todoFilter = 'all';
  function renderTodo() {
    const kw = $('#todoSearch').value.trim();
    const list = todoItems.filter(t => {
      const okF = todoFilter === 'all' ||
        (todoFilter === 'today' && t.meta.startsWith('今天')) ||
        (todoFilter === 'pending' && !t.done) ||
        (todoFilter === 'done' && t.done);
      const okK = !kw || t.name.includes(kw);
      return okF && okK;
    });
    $('#todoList').innerHTML = list.map((t, i) => `
      <div class="todo-item ${t.done ? 'done' : ''}" data-i="${todoItems.indexOf(t)}">
        <span class="todo-check">✓</span>
        <div>
          <div class="todo-name">${escapeHtml(t.name)}</div>
          <div class="todo-meta">
            <span class="pri-dot pri-${t.pri}"></span>${escapeHtml(t.meta)} · ${escapeHtml(t.src)}
          </div>
        </div>
        <div class="todo-op">
          <button class="op-defer">明天</button>
          <button class="op-del danger">删除</button>
        </div>
      </div>`).join('');
    $('#todoEmpty').hidden = list.length > 0;
    updateTodoCounts();
  }

  /* 分类计数：待办 tab 徽标随真实数据动态计算（全部/今天/未完成/已完成） */
  function updateTodoCounts() {
    const counts = {
      all: todoItems.length,
      today: todoItems.filter(t => t.meta.startsWith('今天')).length,
      pending: todoItems.filter(t => !t.done).length,
      done: todoItems.filter(t => t.done).length
    };
    $$('#todoTabs .tab').forEach(b => {
      const i = b.querySelector('i');
      if (i) i.textContent = counts[b.dataset.filter] || 0;
    });
  }

  $('#todoList').addEventListener('click', (e) => {
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const idx = +item.dataset.i;
    const t = todoItems[idx];
    if (e.target.closest('.todo-check')) {
      t.done = !t.done;
      renderTodo();
      saveTodos();
      updateCalEventDone(t.taskId, t.done); // 完成状态同步到日历事件
    } else if (e.target.closest('.op-defer')) {
      t.meta = t.meta.replace(/今天/, '明天').replace(/本周末/, '明天');
      renderTodo();
      saveTodos();
      toast('已顺延到明天');
    } else if (e.target.closest('.op-del')) {
      const t = todoItems[idx];
      if (t.taskId != null) removeCalEventById(t.taskId); // 联动删除日历事件，双向同步
      todoItems.splice(idx, 1);
      renderTodo();
      saveTodos();
      toast('已删除');
    }
  });

  $('#todoTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    todoFilter = tab.dataset.filter;
    $$('#todoTabs .tab').forEach(t => t.classList.toggle('active', t === tab));
    renderTodo();
  });

  $('#todoSearch').addEventListener('input', renderTodo);

  /* ==================================================
     日历页
  ================================================== */
  /* 演示事件（仅用于空日历的视觉兜底，绝不参与用户数据的去重/写入） */
  /* 注：CAL_YEAR / CAL_MONTH 已在文件顶部按真实系统日期统一定义 */
  const demoEvents = {
    3: [{ id: 'demo_3_0', name: '产品评审会', time: '09:30', synced: true }],
    5: [{ id: 'demo_5_0', name: '整理方案初稿', time: '14:00', synced: true }],
    6: [{ id: 'demo_6_0', name: '去银行办业务', time: '08:30', synced: true }, { id: 'demo_6_1', name: '和客户开产品会', time: '15:00', synced: true }, { id: 'demo_6_2', name: '健身', time: '19:00', synced: false }],
    8: [{ id: 'demo_8_0', name: '联系设计师', time: '11:00', synced: true }],
    12: [{ id: 'demo_12_0', name: '周会', time: '10:00', synced: true }],
    15: [{ id: 'demo_15_0', name: '交方案截止', time: '全天', synced: true }],
    20: [{ id: 'demo_20_0', name: '团建', time: '18:00', synced: false }]
  };

  /* 日历数据：localStorage 持久化（key: calendar），与演示事件合并 */
  function loadCalendar() {
    const stored = loadData().calendar;
    return (stored && typeof stored === 'object') ? stored : {};
  }
  function saveCalendar(patch) {
    const cur = loadCalendar();
    Object.keys(patch).forEach(d => {
      const arr = cur[d] || [];
      // 按 id 幂等：已存在则更新，不存在则追加，避免重复累加
      patch[d].forEach(ev => {
        const idx = arr.findIndex(x => x.id && ev.id && x.id === ev.id);
        if (idx >= 0) arr[idx] = ev; else arr.push(ev);
      });
      cur[d] = arr;
    });
    saveData({ calendar: cur });
  }
  function getEvents() {
    const merged = {};
    Object.keys(demoEvents).forEach(d => { merged[d] = demoEvents[d].slice(); });
    const stored = loadCalendar();
    Object.keys(stored).forEach(d => {
      merged[d] = (merged[d] || []).concat(stored[d]);
    });
    return merged;
  }
  /* 任务 → 日号：基于真实系统日期推算，不再硬编码 2026/8/5。
     兼容规则引擎输出（"8月5日（周X）"）与 LLM 输出（今天/明天/后天/周X/周末）。 */
  function taskDayNum(t) {
    const date = t.date || '';
    const m = date.match(/(\d{1,2})月(\d{1,2})日/);
    if (m) { const d = +m[2]; return clampDay(d); }            // 已带具体日期
    if (/后天/.test(date)) return clampDay(TODAY_DAY + 2);
    if (/明天|明早|明晚|明日/.test(date)) return clampDay(TODAY_DAY + 1);
    if (/今天|今晚|现在/.test(date)) return TODAY_DAY;          // 真实今天
    // 周X：以真实今天所在周几为锚，推算本月下一个该周几
    const wd = date.match(/周([一二三四五六日天])|星期([一二三四五六日天])/);
    if (wd) {
      const target = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 }[wd[1] || wd[2]];
      let off = (target - TODAY_WD + 7) % 7;
      if (off === 0) off = 7;
      return clampDay(TODAY_DAY + off);
    }
    if (/周末/.test(date)) {                                     // 下一个周六
      let off = (6 - TODAY_WD + 7) % 7;
      if (off === 0) off = 7;
      return clampDay(TODAY_DAY + off);
    }
    return null;
  }

  function renderCalendar(selectedDay) {
    const first = new Date(calYear, calMonth, 1);
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7; // 周一起始
    const isCurMonth = calYear === CAL_YEAR && calMonth === CAL_MONTH;
    const today = TODAY_DAY;
    const events = getEvents();

    let cells = '';
    for (let i = 0; i < offset; i++) cells += `<div class="cal-day other"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const has = events[d] || [];
      const cls = ['cal-day', (isCurMonth && d === today) ? 'today' : '', d === selectedDay ? 'selected' : ''].join(' ');
      cells += `<div class="${cls}" data-day="${d}">
        ${d}
        ${has.length ? `<span class="dots">${has.map(h => `<i class="${h.synced ? 'synced' : ''}"></i>`).join('')}</span>` : ''}
      </div>`;
    }
    $('#calGrid').innerHTML = cells;
    $('#calTitle').textContent = calYear + '年' + (calMonth + 1) + '月';
  }

  function renderDaySchedule(day) {
    const list = getEvents()[day];
    const box = $('#daySchedule');
    if (!list || !list.length) {
      box.innerHTML = `<h3>${day} 日 · 暂无日程</h3><p style="font-size:13px;color:var(--ink-3);padding-top:6px">点下方“添加日程”手动添加，或回首页说一句话自动排期</p>`;
      return;
    }
    box.innerHTML = `<h3>${day} 日 · ${list.length} 项日程</h3>` + list.map((n) => `
      <div class="ds-item">
        <span class="ds-time">${escapeHtml(n.time || '—')}</span>
        <span class="ds-name">${escapeHtml(n.name)}</span>
        <span class="ds-sync">${n.synced ? '已同步 ✓' : '待同步'}</span>
        <button class="ds-del" data-del data-day="${day}" data-eid="${escapeHtml(n.id || '')}" data-name="${escapeHtml(n.name)}" title="删除日程">✕</button>
      </div>`).join('');
  }

  let calYear = CAL_YEAR, calMonth = CAL_MONTH;
  let calSelected = TODAY_DAY;
  renderCalendar(calSelected);
  renderDaySchedule(calSelected);
  const _lbl0 = $('#calAddDayLabel'); if (_lbl0) _lbl0.textContent = calSelected;

  $('#calGrid').addEventListener('click', (e) => {
    const day = e.target.closest('.cal-day');
    if (!day || day.classList.contains('other')) return;
    calSelected = +day.dataset.day;
    renderCalendar(calSelected);
    renderDaySchedule(calSelected);
    const _l = $('#calAddDayLabel'); if (_l) _l.textContent = calSelected;
  });

  $('[data-cal="prev"]').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar(calSelected);
  });
  $('[data-cal="next"]').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar(calSelected);
  });

  /* 日历内删除日程：用户自建项从 localStorage 删；演示数据从 demoEvents 中删 */
  function deleteCalEvent(day, eid, name) {
    // 优先按 id 删除用户数据
    const cur = loadCalendar();
    const arr = cur[day] || [];
    const idx = arr.findIndex(x => (eid && x.id === eid) || (!eid && x.name === name));
    if (idx >= 0) {
      arr.splice(idx, 1);
      if (arr.length) cur[day] = arr; else delete cur[day];
      saveData({ calendar: cur });
      return true;
    }
    // 若未命中，则尝试删除演示数据
    const darr = demoEvents[day];
    if (!darr) return false;
    const didx = darr.findIndex(x => (eid && x.id === eid) || x.name === name);
    if (didx < 0) return false;
    darr.splice(didx, 1);
    if (!darr.length) delete demoEvents[day];
    return true;
  }
  $('#daySchedule').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const day = +del.dataset.day;
    if (deleteCalEvent(day, del.dataset.eid, del.dataset.name)) {
      renderCalendar(calSelected);
      renderDaySchedule(day);
      toast('已删除该日程');
    } else {
      toast('删除失败，日程可能已不存在');
    }
  });

  /* 日历内直接添加日程（针对当前选中日） */
  function refreshCalAddLabel() { const el = $('#calAddDayLabel'); if (el) el.textContent = calSelected; }
  function openCalAddModal() {
    refreshCalAddLabel();
    $('#calAddModal').classList.remove('hidden');
    $('#calEventName').value = '';
    $('#calEventTime').value = '';
    $('#calEventName').focus();
  }
  function closeCalAddModal() { $('#calAddModal').classList.add('hidden'); }
  $('#calAddBtn').addEventListener('click', openCalAddModal);
  $('#calAddCancel').addEventListener('click', closeCalAddModal);
  $('#calAddSave').addEventListener('click', () => {
    const name = $('#calEventName').value.trim();
    if (!name) { toast('请填写日程名称'); return; }
    const time = $('#calEventTime').value.trim() || '—';
    const day = calSelected;
    const cur = loadCalendar();
    cur[day] = cur[day] || [];
    cur[day].push({ id: 'c' + Date.now(), name, time, synced: false });
    saveData({ calendar: cur });
    closeCalAddModal();
    renderCalendar(calSelected);
    renderDaySchedule(day);
    toast('已添加日程：' + name);
  });
  // 点击遮罩关闭弹窗
  $('#calAddModal').addEventListener('click', (e) => {
    if (e.target.id === 'calAddModal') closeCalAddModal();
  });

  $('#viewToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    $$('#viewToggle button').forEach(b => b.classList.toggle('active', b === btn));
    const isWeek = btn.dataset.view === 'week';
    if (isWeek) {
      $('#daySchedule').innerHTML = `
        <h3>本周 · 周视图示意</h3>
        <div class="week-view">
          ${['一', '二', '三', '四', '五', '六', '日'].map((w, i) => `
            <div class="week-col"><span class="wd">${w}</span>${i === 2 ? '<div class="wev">评审会 09:30</div>' : ''}${i === 3 ? '<div class="wev">方案 14:00</div>' : ''}${i === 4 ? '<div class="wev">银行 08:30</div><div class="wev">会议 15:00</div>' : ''}</div>`).join('')}
        </div>`;
    } else {
      renderCalendar(calSelected);
      renderDaySchedule(calSelected);
    }
  });

  /* ==================================================
     我的页
  ================================================== */
  $$('.group .row[data-perm]').forEach(row => row.addEventListener('click', () => {
    toast('该权限用于' + row.dataset.perm + '，可在系统设置中管理');
  }));

  $('#incognito').addEventListener('change', (e) => {
    saveData({ incognito: e.target.checked });
    if (e.target.checked) saveData({ draft: '' });
    toast(e.target.checked ? '无痕模式已开启：草稿不再保存，解析后删除原文' : '无痕模式已关闭');
  });

  /* 删除全部数据：二次确认，避免误操作清空所有本地数据 */
  let dangerArm = false, dangerTimer = null;
  $('.row-danger').addEventListener('click', () => {
    const row = $('.row-danger');
    const label = row.querySelector('span');
    if (!dangerArm) {
      dangerArm = true;
      row.classList.add('armed');
      label.textContent = '⚠ 再次点击确认删除全部数据';
      dangerTimer = setTimeout(() => {
        dangerArm = false; row.classList.remove('armed');
        label.textContent = '删除所有数据';
      }, 3000);
      return;
    }
    clearTimeout(dangerTimer);
    dangerArm = false; row.classList.remove('armed');
    localStorage.removeItem(LS_KEY);
    todoItems = defaultTodos.slice();
    input.value = '';
    syncInput();
    $('#incognito').checked = false;
    rangeSlot = '安排今天';
    $$('.h2-q-item').forEach(c => c.classList.toggle('selected', c.dataset.slot === rangeSlot));
    renderTodo();
    toast('已删除全部本地数据');
  });

  /* ---------- 初始化 ---------- */
  if (isIncognito()) $('#incognito').checked = true;
  renderTodo();
  showScreen('welcome');
})();
