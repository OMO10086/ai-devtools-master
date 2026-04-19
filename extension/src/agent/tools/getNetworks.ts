export interface SimpleRequest {
  url: string;
  method: string;
  status: number;
  time: number; // 单位：ms，取整
  type: string; // image / api/json / css / js / html / other
}

// 用于在内存中缓存最近的请求
const requestLog: SimpleRequest[] = [];

// 初始化监听器：只要 DevTools 打开，就开始自动记录请求（单例）
if (chrome.devtools && chrome.devtools.network) {
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entry = request as any;

    let type = 'other';
    const mime: string = entry?.response?.content?.mimeType || '';

    if (mime.includes('json')) type = 'api/json';
    else if (mime.includes('image')) type = 'image';
    else if (mime.includes('css')) type = 'css';
    else if (mime.includes('script') || mime.includes('javascript')) type = 'js';
    else if (mime.includes('html')) type = 'html';

    const time = typeof entry.time === 'number' ? Math.round(entry.time) : 0;

    const simpleReq: SimpleRequest = {
      url: entry?.request?.url || '',
      method: entry?.request?.method || '',
      status: entry?.response?.status ?? 0,
      time,
      type,
    };

    requestLog.push(simpleReq);

    // ✅ 建议把缓存加大一点，比如 300，避免长页面早期请求被挤掉
    if (requestLog.length > 300) {
      requestLog.shift();
    }
  });
}

/**
 * Network 工具：返回结构化的请求日志
 * 1. 优先返回内存中实时累积的 requestLog（不足时再用 getHAR 兜底）
 * 2. 返回结果已经是“结构化数组”，方便 Agent 按 type/time 过滤。
 */
export const getNetwork = (): Promise<SimpleRequest[] | null> => {
  return new Promise((resolve) => {
    // 只要内存里已有监听到的请求，优先直接用（最新在前）
    if (requestLog.length > 0) {
      resolve([...requestLog].reverse());
      return;
    }

    // 内存里还没有（可能刚打开 DevTools），用 getHAR 兜底一次
    chrome.devtools.network.getHAR((harLog) => {
      if (!harLog || !harLog.entries || harLog.entries.length === 0) {
        resolve(null);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries: SimpleRequest[] = harLog.entries.map((entry: any) => {
        let type = 'other';
        const mime: string = entry?.response?.content?.mimeType || '';

        if (mime.includes('json')) type = 'api/json';
        else if (mime.includes('image')) type = 'image';
        else if (mime.includes('css')) type = 'css';
        else if (mime.includes('script') || mime.includes('javascript')) type = 'js';
        else if (mime.includes('html')) type = 'html';

        const time = typeof entry.time === 'number' ? Math.round(entry.time) : 0;

        return {
          url: entry?.request?.url || '',
          method: entry?.request?.method || '',
          status: entry?.response?.status ?? 0,
          time,
          type,
        };
      });

      // 兜底：只返回最后 200 条，够分析性能了
      resolve(entries.slice(-200).reverse());
    });
  });
};