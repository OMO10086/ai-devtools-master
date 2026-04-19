console.log('Background script is running...');

// 监听来自 DevTools Panel / content script 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'AI_CHAT') {
    const payload = message.payload;

    // 调用本地 Node.js 后端
    fetch('http://localhost:3000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: payload }),
    })
      .then(async (resp) => {
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          sendResponse({ error: data.error || 'Request failed' });
        } else {
          sendResponse({ reply: data.reply ?? JSON.stringify(data) });
        }
      })
      .catch((err) => {
        sendResponse({ error: err.message || 'Network error' });
      });

    // 告诉 Chrome：这是一个异步响应
    return true;
  }

  // 未处理的消息，直接忽略
  return false;
});