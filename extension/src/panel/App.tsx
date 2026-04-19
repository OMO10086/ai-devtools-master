import { useState, useEffect, useRef } from 'react';
import './App.css';
import { runAgent } from '../agent/agent';

interface Message {
  role: 'user' | 'ai' | 'error';
  content: string;
  action?: { label: string; question: string };
}

function App() {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [history, loading]);

  // 获取页面基础信息
  const getPageInfo = async () => {
    return new Promise((resolve) => {
      const tabId = chrome.devtools.inspectedWindow.tabId;
      chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTENT' }, (res) => {
        resolve(chrome.runtime.lastError ? null : res);
      });
    });
  };

  // 获取当前选中元素信息
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getSelectedElementDetail = (): Promise<any> => {
    return new Promise((resolve) => {
      chrome.devtools.inspectedWindow.eval(
        `(function() {
          const el = $0; // DevTools 当前选中元素
          if (!el) return null;
          
          let selector = el.tagName.toLowerCase();
          if (el.id) selector += '#' + el.id;
          else if (el.className && typeof el.className === 'string') {
            selector += '.' + el.className.trim().split(/\\s+/).join('.');
          }

          const computed = window.getComputedStyle(el);
          
          return {
            selector: selector,
            tagName: el.tagName,
            textContent: (el.textContent || '').substring(0, 200),
            outerHTML: (el.outerHTML || '').substring(0, 500),
            computedStyle: {
              color: computed.color,
              backgroundColor: computed.backgroundColor,
              fontSize: computed.fontSize,
              display: computed.display,
              width: computed.width,
              height: computed.height,
              padding: computed.padding,
              margin: computed.margin,
              position: computed.position
            }
          };
        })()`,
        (result, isException) => {
          if (isException) resolve(null);
          else resolve(result);
        }
      );
    });
  };

  // 发送信息
  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const currentInput = input;
    setInput('');
    setHistory((prev) => [...prev, { role: 'user', content: currentInput }]);
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const [pageInfo, selectedElement] = await Promise.all([
        getPageInfo(),
        getSelectedElementDetail(),
      ]);

      // Agent 判断要不要调用 DOM/CSS/Network 等工具
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let agentResult: any = { usedTools: [] };
      try {
        agentResult = await runAgent(currentInput);
      } catch (err) {
        console.warn('Agent error', err);
      }
      const tools = agentResult.usedTools || [];

      // 组装发给后端的大 Prompt
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = {
        userQuestion: currentInput,
        context: {
          page: pageInfo || {},
          selectedElement: selectedElement || {
            note: '当前未在 DevTools 选中任何元素',
          },
        },
        toolsData: {},
      };

      if (tools.includes('network')) payload.toolsData.network = agentResult.networkData;
      if (tools.includes('dom')) payload.toolsData.fullDom = agentResult.domHtml;
      if (tools.includes('css')) payload.toolsData.globalCss = agentResult.cssStyles;

      const prompt = JSON.stringify(payload, null, 2);

      // === 第四步：发送给 background，再由 background 请求后端 ===
      const data = await new Promise<{ reply?: string; error?: string }>((resolve, reject) => {
        // 用 AbortController 兼容“停止”按钮
        const timeoutId = setTimeout(() => {
          reject(new Error('Request timeout'));
        }, 60000); // 60 秒超时可自己调

        chrome.runtime.sendMessage(
          {
            type: 'AI_CHAT',
            payload: prompt, // 把 JSON 字符串传给 background
          },
          (res) => {
            clearTimeout(timeoutId);

            // 处理 runtime 错误（扩展关闭等）
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!res) {
              reject(new Error('Empty response from background'));
              return;
            }
            if (res.error) {
              reject(new Error(res.error));
              return;
            }
            resolve(res);
          }
        );
      });

      let aiReply = data.reply ?? '';

      // 解析 ACTION（可选操作按钮）
      let actionData: Message['action'] | null = null;
      const actionRegex = /<<<ACTION(\{.*?\})>>>/;
      const actionMatch = aiReply.match(actionRegex);
      if (actionMatch) {
        try {
          actionData = JSON.parse(actionMatch[1]);
          aiReply = aiReply.replace(actionRegex, '').trim();
        } catch (e) {
          console.warn('Action parse failed', e);
        }
      }

      // 解析并执行 CODE 代码块
      const codeRegex = /<<<CODE([\s\S]*?)CODE>>>/;
      const codeMatch = aiReply.match(codeRegex);
      if (codeMatch) {
        const code = codeMatch[1].trim();
        if (code) {
          chrome.devtools.inspectedWindow.eval(code);
        }
        aiReply = aiReply.replace(codeRegex, '\n✨ _(代码已自动执行)_');
      }

      setHistory((prev) => [
        ...prev,
        { role: 'ai', content: aiReply, action: actionData || undefined },
      ]);
    } 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Request aborted by user');
      } else {
        console.error(err);
        setHistory((prev) => [
          ...prev,
          { role: 'error', content: 'Error: ' + err.message },
        ]);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setHistory((prev) => [
      ...prev,
      { role: 'error', content: '⛔ 用户手动停止了生成。' },
    ]);
  };

  const handleActionClick = (action: Message['action']) => {
    if (!action) return;
    setInput(action.question);
  };

  return (
    <div className="chat-root">
      <header className="chat-header">
        <div className="chat-header-title">Web 前端智能助手</div>
        <div className="chat-header-desc">
          分析 DOM / CSS / 网络请求，辅助调试与优化
        </div>
      </header>

      {/* 聊天记录 */}
      <main className="chat-main">
        <div className="chat-messages" ref={chatBoxRef}>
          {history.map((msg, i) => {
            const rowClass =
              msg.role === 'user' ? 'chat-bubble-row-user' : 'chat-bubble-row-ai';
            const bubbleClass =
              msg.role === 'user'
                ? 'chat-bubble chat-bubble-user'
                : msg.role === 'ai'
                ? 'chat-bubble chat-bubble-ai'
                : 'chat-bubble chat-bubble-error';

            return (
              <div key={i} className={`chat-bubble-row ${rowClass}`}>
                <div className={bubbleClass}>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                    {msg.content}
                  </pre>

                  {msg.action && (
                    <button
                      className="chat-action-btn"
                      onClick={() => handleActionClick(msg.action)}
                    >
                      💡 {msg.action.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="chat-bubble-row chat-bubble-row-ai">
              <div className="chat-bubble chat-bubble-ai">
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
              </div>
            </div>
          )}
        </div>
      </main>
      {/* 输入 */}
      <footer className="chat-footer">
        <div className="chat-input-wrapper">
          <textarea
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="例如：分析这个页面的 HTML 结构？"
          />
          <div className="chat-input-actions">
            {!loading ? (
              <button
                className="chat-btn chat-btn-primary"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                发送
              </button>
            ) : (
              <button
                className="chat-btn chat-btn-danger"
                onClick={handleStop}
              >
                ⏹ 停止
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;