const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
});

// 健康检查
app.get('/', (_req, res) => {
  res.send('AI DevTools Server is Running!');
});

/**
 * 判断是不是“闲聊 / 打招呼”
 */
function isSmallTalk(question) {
  if (!question) return false;
  const q = String(question).trim().toLowerCase();
  return /^(hi|hello|hey|你好|嗨|早上好|晚上好|在吗|在不在)/.test(q);
}

/* ========== 多步推理：首屏加载慢的会话状态管理 ========== */

/**
 * AgentState 只针对“首屏加载很慢”这种多步问题
 * step:
 *   - idle:     还没做过任何分析
 *   - netDone:  已经做过 Network 分析
 *   - done:     已经完成多步分析
 */
const sessionStates = new Map(); // key: sessionId, value: AgentState

function getSessionId(parsed) {
  // 前端可以在 payload 里带一个 sessionId；没有就用 default
  return (parsed && parsed.sessionId) || 'default-session';
}

/**
 * 第一步：只用 network 做分析，返回原因 + 引导按钮
 */
function firstScreenStep1(network) {
  if (!Array.isArray(network) || network.length === 0) {
    return {
      text: '当前没有可用的网络数据，可能需要在打开 DevTools 后刷新页面再重试。',
      action: null,
    };
  }

  // 找出耗时最高的前 3 个请求
  const sorted = [...network].sort((a, b) => (b.time || 0) - (a.time || 0));
  const top3 = sorted.slice(0, 3);

  const lines = [];
  lines.push('原因分析（基于网络请求）：');
  top3.forEach((req, idx) => {
    const urlShort = (req.url || '').split('?')[0].slice(0, 80);
    lines.push(`${idx + 1}. ${urlShort} — ${req.time}ms (${req.type || 'unknown'})`);
  });

  // 统计总请求数 + 重复 URL（前 2 个）
  const total = network.length;
  const countByUrl = {};
  network.forEach((r) => {
    const key = (r.url || '').split('?')[0].slice(0, 80);
    countByUrl[key] = (countByUrl[key] || 0) + 1;
  });
  const repeated = Object.entries(countByUrl)
    .filter(([, c]) => c > 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  lines.push('');
  lines.push(`总请求数：${total}`);
  if (repeated.length) {
    lines.push('存在多次重复请求：');
    repeated.forEach(([u, c]) => {
      lines.push(`- ${u} (${c} 次)`);
    });
  }

  // 引导第二步
  const action = {
    label: '继续分析 DOM 对首屏的影响',
    question: '请继续基于当前会话，分析这些慢资源在 DOM 中是否阻塞了首屏渲染',
  };

  return {
    text: lines.join('\n'),
    action,
  };
}

/**
 * 第二步：结合 DOM，输出综合结论 + 优化建议
 */
function firstScreenStep2(state, fullDom) {
  const lines = [];

  lines.push('综合分析结果：');

  // 1. 延续上一步的网络结果（核心还是网络分析）
  if (state.slowResources && state.slowResources.length) {
    lines.push('1. 网络层面的瓶颈：');
    state.slowResources.slice(0, 3).forEach((r, idx) => {
      const urlShort = (r.url || '').split('?')[0].slice(0, 80);
      lines.push(`   ${idx + 1}) ${urlShort} — ${r.time}ms (${r.type || 'unknown'})`);
    });
  }

  // 2. 简单看 DOM 里是否有同步 script 或疑似首屏大图（纯字符串判断）
  const dom = typeof fullDom === 'string' ? fullDom : '';
  let hasSyncScript = false;
  let hasHeroImg = false;

  if (dom) {
    if (dom.includes('<script') && !dom.includes('async') && !dom.includes('defer')) {
      hasSyncScript = true;
    }
    if (dom.match(/<img[^>]+(banner|hero|slider|carousel)[^>]*>/i)) {
      hasHeroImg = true;
    }
  }

  if (hasSyncScript || hasHeroImg) {
    lines.push('');
    lines.push('2. DOM 结构中的潜在阻塞点（如果存在）：');
    if (hasSyncScript) {
      lines.push('- 存在未使用 async/defer 的同步 script 标签，可能阻塞首屏渲染。');
    }
    if (hasHeroImg) {
      lines.push('- 检测到疑似首屏大图（banner/hero/slider），应考虑压缩与懒加载。');
    }
  }

  // 3. 优化建议（无论有没有大图，都要有）
  lines.push('');
  lines.push('优化建议：');
  lines.push('1. 对上面耗时较长的静态资源开启缓存、压缩，必要时使用 CDN。');
  if (hasSyncScript) {
    lines.push('2. 将首屏非关键脚本改为 async 或 defer，减少阻塞。');
  }
  if (hasHeroImg) {
    lines.push('3. 对首屏大图使用合适的尺寸、压缩和懒加载，并考虑增加 srcset 响应式配置。');
  }
  if (!hasSyncScript && !hasHeroImg) {
    lines.push('2. 检查是否有多余的接口请求或第三方埋点，可根据实际业务精简。');
  }

  // 只有真的检测到疑似首屏大图时，才给 srcset 按钮
  let action = null;
  if (hasHeroImg) {
    action = {
      label: '帮我生成图片 srcset 建议',
      question:
        '请根据刚才分析到的首屏大图，给出一段 <img> 的 srcset 配置建议（无需真实代码，只要配置示例）。',
    };
  }

  return {
    text: lines.join('\n'),
    action,
  };
}

/* ============================ /chat 主逻辑 ============================ */

app.post('/chat', async (req, res) => {
  try {
    const rawMessage = req.body.message;
    if (!rawMessage) {
      return res.status(400).json({ error: 'message is required' });
    }

    let parsed = null;
    let mode = 'chat';
    let userQuestion = rawMessage;

    try {
      parsed = JSON.parse(rawMessage);
      mode = parsed.mode || 'chat';
      userQuestion = parsed.userQuestion || '';
    } catch (e) {
      console.log('收到非 JSON 格式消息，降级为纯文本处理');
      parsed = null;
      mode = 'chat';
      userQuestion = rawMessage;
    }

    // 闲聊
    if (mode === 'chat' && isSmallTalk(userQuestion)) {
      const completion = await client.chat.completions.create({
        model: 'deepseek-ai/DeepSeek-V3',
        messages: [
          { role: 'system', content: '你是一个友好的前端助手。' },
          { role: 'user', content: userQuestion },
        ],
      });
      const reply =
        completion.choices?.[0]?.message?.content ||
        '你好，我是你的前端调试助手。';
      return res.json({ reply });
    }

    /* ===== 专门处理“首屏加载很慢”的多步推理 ===== */

    const lowerQ = String(userQuestion || '').toLowerCase();
    const sessionId = getSessionId(parsed);
    const toolsData = parsed && parsed.toolsData ? parsed.toolsData : {};
    const network = toolsData.network || null;
    const fullDom = toolsData.fullDom || null;

    // 场景 1：第一次问“为什么首屏加载很慢”
    if (
      lowerQ.includes('首屏') &&
      lowerQ.includes('慢') &&
      !lowerQ.includes('继续')
    ) {
      const step1Result = firstScreenStep1(network);

      // 记录前几条慢请求到会话状态
      const slowRes = Array.isArray(network)
        ? [...network].sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 5)
        : [];

      sessionStates.set(sessionId, {
        step: 'netDone',
        slowResources: slowRes,
      });

      let reply = step1Result.text;
      if (step1Result.action) {
        reply += `\n<<<ACTION${JSON.stringify(step1Result.action)}>>>`;
      }
      return res.json({ reply });
    }

    // 场景 2：用户点按钮后“继续分析 DOM 对首屏的影响”
    if (lowerQ.includes('继续') && lowerQ.includes('首屏')) {
      const prev = sessionStates.get(sessionId) || { step: 'idle' };
      const final = firstScreenStep2(prev, fullDom);

      sessionStates.set(sessionId, {
        ...prev,
        step: 'done',
      });

      let reply = final.text;
      if (final.action) {
        reply += `\n<<<ACTION${JSON.stringify(final.action)}>>>`;
      }
      return res.json({ reply });
    }

    /* ===== 其它问题：走 LLM + systemPrompt 统一处理 ===== */

    const systemPrompt = `
      你是一个 Chrome DevTools 的命令行式调试助手。
      你的目标是：极度简洁、直击要害。

      回答规范：
      1. 拒绝废话：不要说“根据计算样式显示”、“该元素是...”、“如果您希望...”。
      2. 直接给值：如果用户问属性（如 padding, color），直接告诉是多少。
      3. 不需主动扩展：除非用户明确要求修改或询问建议，否则不要主动生成修改代码或 Action 按钮。
      4. 格式纯净：不要使用 Markdown 加粗（不要出现 **），直接输出文字。
      5. 群控性能优化：
         当用户要求修改“所有”元素的样式（如“隐藏所有图片”、“把所有 div 变红”）时：
         - 禁止使用 document.querySelectorAll(...).forEach 循环。
         - 必须通过创建 <style> 标签并注入 CSS 规则来实现。
      6. 图片耗时分析：
         如果用户询问“哪些图片加载超过 XXXms / XXX 毫秒”：
         1) 只能使用 toolsData.network（SimpleRequest[]）来判断：
            - 过滤条件：req.type === 'image' 且 req.time > XXX（XXX 从问题中提取数字，例如 500ms→500）
         2) 按耗时从大到小排序，最多列出 10 条。
         3) 每行输出：文件名或 URL + 耗时（ms）。
         4) 如无匹配结果，回答：“当前页面没有加载耗时超过 XXXms 的图片。”
      7. 回答“为什么页面首屏加载很慢？”时，如果未走专用多步逻辑，则：
         - 按上面的图片/请求统计规则，给出简要原因和 2–3 条建议。


      代码执行协议：
      - 若用户明确要求“修改”、“隐藏”、“变色”等操作，生成 JS 代码，并用：
        <<<CODE
        // js 代码
        CODE>>>
        包裹，前端会在页面中执行。
      - 其它纯查询问题不要输出 CODE。

      变色/还原协议：
      - 当用户要求“变色”时，先用 window._ai_origin_bg 保存原始颜色，再设置新颜色。
        例如：
        <<<CODE
        if (!window._ai_origin_bg) window._ai_origin_bg = document.body.style.backgroundColor;
        document.body.style.backgroundColor = 'pink';
        CODE>>>
      - 当用户要求“恢复”或“还原”时，优先用 window._ai_origin_bg 还原原始颜色，并清空该变量。
        例如：
        <<<CODE
        if (window._ai_origin_bg !== undefined) {
          document.body.style.backgroundColor = window._ai_origin_bg;
          window._ai_origin_bg = undefined;
        }
        CODE>>>

      数据源：
      - context.selectedElement：当前选中元素（优先用于样式问题）。
      - toolsData：网络 / DOM / CSS 数据。

      回答要像 CLI 终端输出一样干练。
    `.trim();

    const userContent = parsed
      ? JSON.stringify(parsed, null, 2)
      : rawMessage;

    const completion = await client.chat.completions.create({
      model: 'deepseek-ai/DeepSeek-V3',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });

    const reply =
      completion.choices?.[0]?.message?.content || '（没有生成有效回复）';
    return res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    return res
      .status(500)
      .json({ error: 'Internal server error: ' + err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`AI DevTools server listening on http://localhost:${port}`);
});