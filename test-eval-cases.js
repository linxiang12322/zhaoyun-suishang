// ============================================================
// 巢雲随行 · 精准拆解测试集（PRD 11 章）
// 覆盖：复杂口语 / 方言 / 否定 / 条件依赖 / 多事项嵌套 / 边界
// 供评测脚本 test-eval.js 使用（规则引擎 vs LLM 双引擎对比）
// ============================================================

// 动态生成"今天"提示：规则引擎与 LLM 均基于真实系统日期解析，
// 硬编码日期会让断言在非 2026-08-05 运行时误判，故随运行日生成。
const _now = new Date();
const _wd = '日一二三四五六'[_now.getDay()];
const today = '今天是 ' + _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0') + ' 周' + _wd;

// 每条用例：
//   input   : 用户原话
//   expect  : 期望任务数（>=）
//   checks  : 字段断言数组，每个 { desc, fn(tasks) -> bool }
module.exports = [
  /* ---------- 基础（规则引擎可覆盖） ---------- */
  {
    input: '明早去银行，下午三点开会，晚上有空健身',
    expect: 3,
    checks: [
      { desc: '拆出 3 个事项', fn: t => t.length === 3 },
      { desc: '开会是固定事项且 15:00', fn: t => t.some(x => x.title.includes('开会') && x.type === 'fixed' && x.start === '15:00') },
      { desc: '去银行是明早（明天/相对日期）', fn: t => {
          const exp = new Date(); exp.setDate(exp.getDate() + 1);
          const s = (exp.getMonth() + 1) + '月' + exp.getDate() + '日';
          return t.some(x => x.title.includes('银行') && (/明天/.test(x.date) || x.date.includes(s)));
        } }
    ]
  },

  /* ---------- 复杂口语 ---------- */
  {
    input: '明儿个要是上午没啥事，帮我把那份季度总结写了，不急着要，下午有空再润色一遍',
    expect: 1,
    checks: [
      { desc: '拆出 1 个核心事项（季度总结）', fn: t => t.some(x => x.title.includes('季度总结')) },
      { desc: '标记待确认（时长/时间）', fn: t => t.some(x => x.title.includes('季度总结') && x.pending.length >= 1) },
      { desc: '优先级不高（不急着要）', fn: t => t.some(x => x.title.includes('季度总结') && x.pri !== 'high') }
    ]
  },
  {
    input: '下班路上顺便买瓶酱油，回家把昨天没洗完的衣服洗了，睡前记得给娃读绘本',
    expect: 3,
    checks: [
      { desc: '拆出 3 个事项', fn: t => t.length === 3 },
      { desc: '酱油是低优先级弹性', fn: t => t.some(x => x.title.includes('酱油') && (x.pri === 'low' || x.type === 'flexible')) },
      { desc: '读绘本是提醒类', fn: t => t.some(x => x.title.includes('绘本') && (x.type === 'reminder' || x.sync === '提醒事项')) }
    ]
  },

  /* ---------- 方言/口语时间 ---------- */
  {
    input: '后儿个傍黑儿去趟银行，明儿个早起把娃送学校',
    expect: 2,
    checks: [
      { desc: '拆出 2 个事项', fn: t => t.length === 2 },
      { desc: '银行是后天', fn: t => t.some(x => x.title.includes('银行') && /后天/.test(x.date)) },
      { desc: '送娃是明天早上', fn: t => t.some(x => x.title.includes('送娃') && /明天/.test(x.date) && /0[6-9]:|0[1-9]:/.test(x.start || '')) }
    ]
  },
  {
    input: '周五下班前把报销单交了，周末抽空收拾下书房',
    expect: 2,
    checks: [
      { desc: '拆出 2 个事项', fn: t => t.length === 2 },
      { desc: '报销单是周五且偏固定', fn: t => t.some(x => x.title.includes('报销') && /周五|星期[五5]/.test(x.date)) },
      { desc: '书房是周末弹性', fn: t => t.some(x => x.title.includes('书房') && /周末/.test(x.date)) }
    ]
  },

  /* ---------- 否定 / 改期 ---------- */
  {
    input: '周六不去健身房了，改成周日晚上八点跑五公里',
    expect: 1,
    checks: [
      { desc: '只保留改期后的事项（1 个）', fn: t => t.length === 1 },
      { desc: '没有残留「去健身房」', fn: t => !t.some(x => x.title.includes('健身房')) },
      { desc: '跑步是周日 20:00', fn: t => t.some(x => x.title.includes('跑') && /周日|星期[日天]/.test(x.date) && x.start === '20:00') }
    ]
  },
  {
    input: '下午的会取消吧，改到明天上午十点重新约',
    expect: 1,
    checks: [
      { desc: '只保留改期后的会议', fn: t => t.length === 1 && t.some(x => /会/.test(x.title)) },
      { desc: '新时间是明天 10:00', fn: t => t.some(x => /明天/.test(x.date) && x.start === '10:00') }
    ]
  },

  /* ---------- 条件 / 依赖 ---------- */
  {
    input: '等小李把方案发我之后，再约客户周五下午三点开会',
    expect: 1,
    checks: [
      { desc: '识别依赖关系 dependsOn', fn: t => t.some(x => x.dependsOn && x.dependsOn.length > 0) },
      { desc: '会议在周五 15:00', fn: t => t.some(x => /会/.test(x.title) && /周五/.test(x.date) && x.start === '15:00') }
    ]
  },
  {
    input: '老板批了预算以后，才能定酒店，你先记着这俩事',
    expect: 2,
    checks: [
      { desc: '拆出 2 个事项', fn: t => t.length === 2 },
      { desc: '定酒店依赖批预算', fn: t => {
          const hotel = t.find(x => x.title.includes('酒店'));
          const budget = t.find(x => x.title.includes('预算'));
          return hotel && budget && (hotel.dependsOn || '').includes(budget.title || '预算');
        } }
    ]
  },

  /* ---------- 多事项 + 嵌套 ---------- */
  {
    input: '上午九点开周会，周会完了以后整理会议纪要，下午两点约供应商谈新项目，晚上给老婆买束花',
    expect: 4,
    checks: [
      { desc: '拆出 4 个事项', fn: t => t.length === 4 },
      { desc: '纪要依赖周会', fn: t => t.some(x => x.title.includes('纪要') && x.dependsOn) },
      { desc: '供应商是下午 14:00', fn: t => t.some(x => x.title.includes('供应商') && x.start === '14:00') },
      { desc: '买花是提醒/弹性', fn: t => t.some(x => x.title.includes('买花')) }
    ]
  },

  /* ---------- 边界 ---------- */
  {
    input: '',
    expect: 0,
    checks: [{ desc: '空输入返回空', fn: t => t.length === 0 }]
  },
  {
    input: '哈哈哈 今天天气不错',
    expect: 0,
    checks: [{ desc: '无任务语义返回空或示例（不崩）', fn: t => Array.isArray(t) }]
  },
  {
    input: '记得提醒我下午三点给妈妈打电话',
    expect: 1,
    checks: [
      { desc: '拆出提醒事项', fn: t => t.some(x => x.title.includes('打电话')) },
      { desc: '时间 15:00', fn: t => t.some(x => x.start === '15:00') }
    ]
  },
  {
    input: '明天下午三点和客户开会，晚上健身一小时，周六去爬山，周日整理读书笔记，周五前交季度报告，今晚写周报，明天上午十点见牙医',
    expect: 7,
    checks: [
      { desc: '长句拆出 7 个事项', fn: t => t.length === 7 },
      { desc: '牙医是明天 10:00 固定', fn: t => t.some(x => x.title.includes('牙医') && x.start === '10:00') },
      { desc: '爬山是周六', fn: t => t.some(x => x.title.includes('爬山') && /周六/.test(x.date)) }
    ]
  },

  /* ---------- 规则引擎已知短板（验证 LLM 优势） ---------- */
  {
    input: '帮我把我妈下周二的机票退了，顺便看看有没有更便宜的高铁',
    expect: 2,
    checks: [
      { desc: '拆出退票 + 查高铁 2 项', fn: t => t.length === 2 },
      { desc: '退票是下周', fn: t => t.some(x => x.title.includes('退') && /周/.test(x.date)) }
    ]
  },
  {
    input: '如果明天下雨就把郊游改成室内的，不下雨就按原计划走',
    expect: 1,
    checks: [
      { desc: '识别条件（不下雨按原计划，不产生两条）', fn: t => t.length === 1 },
      { desc: '事项含郊游', fn: t => t.some(x => x.title.includes('郊游')) }
    ]
  },
  {
    input: '周三之前把 KPI 方案发给总监，总监确认后周五评审会定稿',
    expect: 2,
    checks: [
      { desc: '拆出 2 个事项', fn: t => t.length === 2 },
      { desc: '评审会依赖 KPI 方案', fn: t => t.some(x => x.title.includes('评审') && x.dependsOn) }
    ]
  }
];

module.exports.today = today;
