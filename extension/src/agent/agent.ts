import { getDOM } from './tools/getDOM';
import { getCSS } from './tools/getCSS';
import { getNetwork } from './tools/getNetworks';
import type { SimpleRequest } from './tools/getNetworks';

export interface AgentResult {
  usedTools: string[]; // 支持多个工具
  domHtml?: string | null;
  cssStyles?: Record<string, string> | null;
  networkData?: SimpleRequest[] | null;
}

export const runAgent = async (question: string): Promise<AgentResult> => {
  try {
    const q = (question || '').toLowerCase();
    const result: AgentResult = { usedTools: [] };

    // === 场景 0：图片 / 资源耗时相关的问题，优先走 Network ===
    // 例如：
    //  - "当前页面上有哪些图片加载超过500ms"
    //  - "哪些资源加载很慢"
    //  - "接口耗时情况"
    if (
      q.includes('图片') && (q.includes('加载') || q.includes('耗时') || q.includes('时间')) ||
      q.includes('resource') ||
      q.includes('performance') ||
      q.includes('加载很慢') ||
      q.includes('慢的请求') ||
      q.includes('接口耗时') ||
      q.includes('请求耗时')
    ) {
      result.usedTools.push('network');
      result.networkData = await getNetwork().catch(() => null);
      return result;
    }

    // === 场景 1：修改 / 操作类问题（需要 DOM + CSS 一起） ===
    // 只要听到“变”、“改”、“设为”、“换”、“背景”、“隐藏”、“显示”、“执行”等字样
    // 就认为用户想“改页面”，同时拿 DOM 和 CSS
    if (
      q.includes('变') ||
      q.includes('改') ||
      q.includes('设') ||
      q.includes('换') ||
      q.includes('背景') ||
      q.includes('隐藏') ||
      q.includes('显示') ||
      q.includes('执行')
    ) {
      const [domData, cssStyles] = await Promise.all([
        getDOM().catch(() => null),
        getCSS().catch(() => null),
      ]);

      result.usedTools = ['dom', 'css'];
      result.domHtml = domData;
      result.cssStyles = cssStyles;
      return result;
    }

    // === 场景 2：普通单工具查询 ===

    // 2.1 Network：网络 / 请求 / 接口 / 首屏加载
    if (
      q.includes('请求') ||
      q.includes('网络') ||
      q.includes('api') ||
      q.includes('接口') ||
      q.includes('首屏') ||
      q.includes('加载速度')
    ) {
      result.usedTools = ['network'];
      result.networkData = await getNetwork().catch(() => null);
      return result;
    }

    // 2.2 CSS：样式 / 颜色 / padding / margin / 字体
    if (
      q.includes('样式') ||
      q.includes('颜色') ||
      q.includes('padding') ||
      q.includes('margin') ||
      q.includes('字体') ||
      q.includes('border')
    ) {
      result.usedTools = ['css'];
      result.cssStyles = await getCSS().catch(() => null);
      return result;
    }

    // 2.3 DOM：结构 / html 结构 / 语义化
    if (
      q.includes('dom') ||
      q.includes('结构') ||
      q.includes('html') ||
      q.includes('语义化') ||
      q.includes('标签')
    ) {
      result.usedTools = ['dom'];
      result.domHtml = await getDOM().catch(() => null);
      return result;
    }

    // 默认：不调用任何工具，由大模型根据已有上下文自己判断
    return result;
  } catch (e) {
    console.warn('runAgent error:', e);
    return { usedTools: [] };
  }
};