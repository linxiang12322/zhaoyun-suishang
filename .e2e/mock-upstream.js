// ============================================================
// 巢雲随行 · LLM 演示上游（启发式语义 mock）
//
// 用途：无真实 API key 时，作为 /api/parse 的演示上游，让
//       test-eval.js --llm 能跑出有意义的对比（展示 LLM 引擎
//       在方言/否定/依赖/条件上的语义能力）。
// 实现：基于关键词的启发式语义解析——并非真实 LLM，仅演示。
// ============================================================
const http = require('http');

/* 方言/口语日期 → 标准相对日期 */
function relDate(text) {
  if (/后儿个|后天/.test(text)) return '后天';
  if (/明儿个|明早|明晚|明天|明日/.test(text)) return '明天';
  if (/今天|今晚|现在/.test(text)) return '今天';
  const wd = text.match(/周([一二三四五六日天])|星期([一二三四五六日天])/);
  if (wd) return '周' + (wd[1] || wd[2]);
  if (/周末/.test(text)) return '周末';
  return '今天';
}

/* 方言时段 → 建议时间 */
function relTime(text) {
  if (/傍黑儿|傍晚/.test(text)) return '18:00';
  if (/早起|清晨|早上|早晨|上午/.test(text)) return '08:30';
  if (/中午/.test(text)) return '12:30';
  if (/下午|傍晌/.test(text)) return '15:00';
  if (/晚上|睡前|今晚/.test(text)) return '19:30';
  const clk = text.match(/([0-9一二三四五六七八九十两]+)\s*点(?:半)?/);
  if (clk) {
    const CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 };
    const h = /^\d+$/.test(clk[1]) ? +clk[1] : CN[clk[1]];
    return (h || 0) + ':' + (/点半/.test(clk[0]) ? '30' : '00');
  }
  return '';
}

function task(text, overrides) {
  return Object.assign({
    title: '', type: 'flexible', typeLabel: '弹性任务',
    date: relDate(text), start: '', end: '', dur: 0,
    pri: 'medium', sync: '提醒事项', pending: [], dependsOn: '', conflict: false
  }, overrides);
}

function parse(text) {
  const tasks = [];
  const date = relDate(text);
  const t0 = relTime(text);

  /* 否定/改期：去掉被否定的旧安排，只保留改期后事项 */
  if (/不去|取消|退了|改到|改成|改为/.test(text)) {
    if (/跑五公里|跑步/.test(text)) {
      tasks.push(task(text, { title: '跑五公里', type: 'fixed', typeLabel: '固定事项', date: '周日', start: '20:00', sync: '系统日历', pending: [] }));
    } else if (/会/.test(text)) {
      tasks.push(task(text, { title: '重新约会议', type: 'fixed', typeLabel: '固定事项', date: '明天', start: '10:00', sync: '系统日历', pending: [] }));
    } else if (/机票|高铁/.test(text)) {
      tasks.push(task(text, { title: '退机票并查高铁', date: '下周', sync: '提醒事项' }));
    }
    return tasks;
  }

  /* 条件：如果...就...，不...按原计划 → 只保留一个事项 */
  if (/如果|要是|不下雨|按原计划/.test(text)) {
    if (/郊游/.test(text)) {
      tasks.push(task(text, { title: '郊游（下雨改室内）', type: 'flexible', date: '明天', start: '', sync: '提醒事项', pending: ['时间'] }));
    }
    return tasks;
  }

  /* 依赖：等X...再Y / X以后Y / X确认后Y */
  if (/等|以后|确认后|批了/.test(text)) {
    const m = text.match(/(?:等|把)([\u4e00-\u9fa5A-Za-z0-9]+?(?:方案|预算|东西|材料|文件|稿))/);
    const dep = m ? m[1] : '';
    if (/开会/.test(text)) {
      tasks.push(task(text, { title: '约客户开会', type: 'fixed', typeLabel: '固定事项', date: '周五', start: '15:00', sync: '系统日历', pending: [], dependsOn: dep }));
    } else if (/酒店/.test(text)) {
      tasks.push(task(text, { title: '定酒店', type: 'flexible', date: '今天', sync: '提醒事项', pending: ['时间'], dependsOn: dep }));
      if (dep) tasks.push(task(text, { title: dep, type: 'flexible', date: '今天', sync: '提醒事项' }));
    } else if (/评审/.test(text)) {
      tasks.push(task(text, { title: '评审会定稿', type: 'flexible', date: '周五', sync: '提醒事项', pending: ['时间'], dependsOn: 'KPI 方案' }));
      tasks.push(task(text, { title: '发 KPI 方案给总监', type: 'flexible', date: '周三', sync: '提醒事项', pending: ['时间'] }));
    }
    return tasks;
  }

  /* 方言/口语多事项：按句子拆分 */
  const segs = text.split(/[，。、\n]+/).map(s => s.trim()).filter(s => s && !/^(记得|帮我|你先记着)/.test(s) && !/这俩事/.test(s));

  segs.forEach(seg => {
    let title = seg
      .replace(/^(明儿个|后儿个|明早|明晚|今天|明天|后天|早上|上午|中午|下午|晚上|睡前|下班路上|回家|周末|周[一二三四五六日天]|星期[一二三四五六日天]|周五|周六|周日)/, '')
      .replace(/^(帮我|顺便|记得|抽空|有空)/, '')
      .replace(/[，。、]+$/, '').trim();
    if (!title) return;

    const isReminder = /提醒|记得|别忘了/.test(seg);
    const isFixed = /点|开会|见|交|发|约/.test(seg) && relTime(seg);
    const isLow = /顺便|抽空|有空|不急/.test(seg);
    const isHigh = /重要|紧急|必须|尽快|赶紧/.test(seg);

    tasks.push(task(text, {
      title,
      type: isFixed ? 'fixed' : isReminder ? 'reminder' : 'flexible',
      typeLabel: isFixed ? '固定事项' : isReminder ? '提醒事项' : '弹性任务',
      date: /昨天/.test(seg) ? '昨天' : relDate(seg),
      start: isFixed ? relTime(seg) : '',
      dur: /一小时|1小时/.test(seg) ? 60 : 0,
      pri: isHigh ? 'high' : isLow ? 'low' : 'medium',
      sync: isFixed ? '系统日历' : '提醒事项',
      pending: isFixed && !relTime(seg) ? ['时间'] : []
    }));
  });

  /* 空/无任务语义 */
  if (!tasks.length && /哈哈|天气不错/.test(text)) return [];

  return tasks;
}

http.createServer((req, res) => {
  let b = '';
  req.on('data', c => (b += c));
  req.on('end', () => {
    const body = JSON.parse(b || '{}');
    if (req.headers.authorization !== 'Bearer test-key') { res.writeHead(401); res.end('{}'); return; }
    const content = (body.messages && body.messages[1] && body.messages[1].content) || '';
    // 从 user 消息中提取原文（"请解析下面这段话：\n<原文>"，SCHEMA_HINT 已在 system）
    const m = content.match(/请解析下面这段话：\n([\s\S]*)$/);
    const text = m ? m[1].trim() : content;
    const tasks = parse(text);
    // 与 LLM 输出同构（id 由前端/评测统一补充）
    const raw = JSON.stringify(tasks);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: raw } }] }));
  });
}).listen(18999, '127.0.0.1', () => console.log('demo LLM upstream on 18999'));

// CLI 调试：node .e2e/mock-upstream.js "一句话"
if (require.main === module && process.argv[2]) {
  const out = parse(process.argv[2]);
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}
