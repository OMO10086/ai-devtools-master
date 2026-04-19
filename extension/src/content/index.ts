chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'GET_PAGE_CONTENT') {
    const content = document.body.innerText || document.body.textContent;
    const html = document.body.innerHTML.slice(0, 5000);

    sendResponse({
      title: document.title,
      url: window.location.href,
      html,
      text: content?.slice(0, 2000) || ''
    });
    return true;
  }

  // 根据选择器获取某个元素的信息
  if (request.type === 'GET_SELECTED_ELEMENT') {
    try {
      const selector = request.selector as string | undefined;
      let element: Element | null = null;

      if (selector) {
        element = document.querySelector(selector);
      }

      // 如果没给 selector，或者没找到，就退化成 body
      if (!element) {
        element = document.body;
      }

      const rect = element.getBoundingClientRect();
      const computed = window.getComputedStyle(element);

      const outerHTML = (element as HTMLElement).outerHTML;
      const textContent = (element.textContent || '').trim().slice(0, 500);
      
      // 挑一些常用样式（后面需要再加）
      const styles: Record<string, string> = {
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        display: computed.display,
        position: computed.position,
        margin: computed.margin,
        padding: computed.padding,
        width: computed.width,
        height: computed.height
      };

      sendResponse({
        title: document.title,
        url: window.location.href,
        outerHTML: outerHTML.slice(0, 2000),
        textContent,
        boundingClientRect: {
          x: rect.x, 
          y: rect.y, 
          width: rect.width, 
          height: rect.height
        },
        styles
      });
    } catch (e) {
      console.error('GET_SELECTED_ELEMENT error', e);
      sendResponse(null);
    }
    return true;
  }
  return true;
});

console.log("AI DevTools Content Script 已就绪");