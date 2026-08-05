/* ============================================================
 * 巢雲随行 · LLM 精准拆解适配层（浏览器 + Node 双端通用）
 *
 * 目标：对齐 PRD 11 章「精准拆解」——复杂口语、方言、否定、
 *       条件、依赖、多事项嵌套等规则引擎无法覆盖的场景。
 *
 * 支持 Provider：
 *   - deepseek : base https://api.deepseek.com  model deepseek-v4-flash / deepseek-v4-pro
 *   - doubao    : base https://ark.cn-beijing.volces.com/api/v3  model 接入点ID
 *   - openai-compatible : 任意 OpenAI 兼容端点（self-host / 代理）
 *
 * 调用优先级（由调用方控制）：
 *   1. 显式传入 provider 配置（前端设置页 / 评测脚本环境变量）
 *   2. 未配置或失败 → 抛出错误，调用方回退规则引擎
 *
 * 浏览器直连 LLM 会暴露 API key，仅供本地原型演示；
 * 生产建议使用同目录 serve.js 的 /api/parse 代理（key 服务端持有）。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.llmParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PROVIDERS = {
    deepseek: { base: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
    doubao: { base: 'https://ark.cn-beijing.volces.com/api/v3', model: '' }, // model=推理接入点ID
    openai: { base: '', model: '' }
  };

  /* ---------- 输出 Schema 约束（强 JSON） ---------- */
  const SCHEMA_HINT = `输出为合法 JSON 数组，不要输出任何其它文字。每个元素字段：
[
  {
    "title": "事项标题（动词短语，去掉时间/语气词）",
    "type": "fixed|flexible|reminder",
    "typeLabel": "固定事项|弹性任务|提醒事项",
    "date": "相对日期，如：今天/明天/后天/周X/周末/X月X日；不确定则留空",
    "start": "开始时间 HH:mm，不确定则留空",
    "end": "结束时间 HH:mm，不确定则留空",
    "dur": "时长分钟数（数字），不确定则 0",
    "pri": "high|medium|low",
    "sync": "系统日历|提醒事项|仅应用内",
    "pending": ["缺失字段名数组，如 时间/时长/日期，没有则 []"],
    "dependsOn": "依赖的前置事项标题，没有则空字符串",
    "conflict": "是否存在时间冲突（布尔）"
  }
]`;

  /* ---------- 构造 system prompt ---------- */
  function buildSystemPrompt(todayHint) {
    return `你是「巢雲随行」的个人助理，负责把用户随口说的一句话/一段话拆解成结构化的日程与待办。

规则：
1. 口语化表达（“明儿个”“傍黑儿”“周末”“下班后”“有空再说”）要理解成明确的时间与语义，不确定的字段标记 pending。
2. 否定句（“周六不去健身了，改周日”）以后续改为准，不要同时保留被否定的旧安排。
3. 条件/依赖（“等小李发方案后，再约客户”）要识别 dependsOn 依赖关系。
4. 一句话可能包含多个事项，全部拆出，不要合并。
5. 明确固定时间的用 type=fixed 并给 start；弹性任务 type=flexible；只提醒不排期的 type=reminder。
6. 优先级：紧急/尽快/必须 → high；顺便/有空 → low；默认 medium。
7. ${todayHint || '今天是 2026-08-05 周三'}
8. 输出格式（严格 JSON 数组，不要输出 markdown 代码块、不要输出任何其它文字）：

${SCHEMA_HINT}`;
  }

  /* ---------- 解析 LLM 输出（容错） ---------- */
  function parseLLMOutput(raw) {
    if (!raw) throw new Error('LLM 返回为空');
    let text = raw.trim();
    // 去掉 ```json ... ``` 包裹
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    // 截取第一个 [ 到最后一个 ]
    const s = text.indexOf('[');
    const e = text.lastIndexOf(']');
    if (s === -1 || e === -1 || e <= s) throw new Error('LLM 输出不是 JSON 数组');
    const arr = JSON.parse(text.slice(s, e + 1));
    if (!Array.isArray(arr)) throw new Error('LLM 输出不是数组');
    return arr.map((t, i) => ({
      id: Date.now() + i,
      title: String(t.title || '').trim() || ('待办事项 ' + (i + 1)),
      type: ['fixed', 'flexible', 'reminder'].includes(t.type) ? t.type : 'flexible',
      typeLabel: t.typeLabel || (t.type === 'fixed' ? '固定事项' : t.type === 'reminder' ? '提醒事项' : '弹性任务'),
      date: t.date || '',
      start: t.start || '',
      end: t.end || '',
      dur: t.dur ? String(t.dur) + ' 分钟' : '待确认',
      pri: ['high', 'medium', 'low'].includes(t.pri) ? t.pri : 'medium',
      sync: t.sync || (t.type === 'fixed' ? '系统日历' : '提醒事项'),
      pending: Array.isArray(t.pending) ? t.pending : [],
      dependsOn: t.dependsOn || '',
      conflict: !!t.conflict,
      ai: true, src: 'llm', conf: 0.92
    }));
  }

  /* ---------- 发起对话（OpenAI 兼容） ---------- */
  async function chatCompletion(cfg, messages, timeoutMs) {
    const base = (cfg.base || PROVIDERS[cfg.provider]?.base || '').replace(/\/+$/, '');
    if (!base || !cfg.apiKey) throw new Error('LLM 未配置（缺少 base/apiKey）');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
    try {
      const resp = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.apiKey
        },
        body: JSON.stringify({
          model: cfg.model || PROVIDERS[cfg.provider]?.model || '',
          messages,
          temperature: 0.1,
          max_tokens: 1500,
          stream: false
        }),
        signal: controller.signal
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error('LLM HTTP ' + resp.status + ' ' + body.slice(0, 120));
      }
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || '';
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- 主入口：把自然语言拆成任务 ---------- */
  /**
   * @param {string} text 用户输入
   * @param {object} [opts]
   *   - provider: { provider:'deepseek'|'doubao'|'openai', base?, model?, apiKey? }
   *   - todayHint: 今天日期提示
   *   - timeoutMs: 超时
   * @returns {Promise<Array>} 任务数组
   */
  async function parseWithLLM(text, opts) {
    opts = opts || {};
    const cfg = opts.provider || {};
    if (!text || !text.trim()) return [];
    const messages = [
      { role: 'system', content: buildSystemPrompt(opts.todayHint) },
      { role: 'user', content: '请解析下面这段话：\n' + text }
    ];
    const raw = await chatCompletion(cfg, messages, opts.timeoutMs);
    return parseLLMOutput(raw);
  }

  return {
    parseWithLLM,
    parseLLMOutput,
    buildSystemPrompt,
    PROVIDERS,
    SCHEMA_HINT
  };
});
