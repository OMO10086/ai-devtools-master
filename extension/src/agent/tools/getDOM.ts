export const getDOM = (): Promise<string> => {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(
      `(function() {
        // 1. 克隆 body，防止破坏原页面
        const clone = document.body.cloneNode(true);
        
        // 2. 暴力瘦身：移除无关紧要的标签
        const trashTags = ['script', 'style', 'svg', 'iframe', 'noscript', 'link', 'meta'];
        trashTags.forEach(tag => {
          const elements = clone.querySelectorAll(tag);
          elements.forEach(el => el.remove());
        });

        // 3. 移除大段注释
        const cleanComments = (node) => {
          for (let i = 0; i < node.childNodes.length; i++) {
            const child = node.childNodes[i];
            if (child.nodeType === 8) { // 8 = Comment
              node.removeChild(child);
              i--;
            } else if (child.nodeType === 1) {
              cleanComments(child);
            }
          }
        };
        cleanComments(clone);

        // 4. 属性清理：只保留 id, class, role 等关键属性，移除 style, data-*, onclick
        const allEls = clone.querySelectorAll('*');
        allEls.forEach(el => {
            // 移除所有属性，只把关键的加回去
            const keepAttrs = ['id', 'class', 'role', 'aria-label', 'alt'];
            const attrs = [...el.attributes];
            attrs.forEach(attr => {
                if (!keepAttrs.includes(attr.name)) {
                    el.removeAttribute(attr.name);
                }
            });
            // 5. 内容截断：如果文字太长（如文章正文），截断它
            if (el.childNodes.length === 1 && el.firstChild.nodeType === 3) {
                if (el.textContent.length > 50) {
                    el.textContent = el.textContent.substring(0, 50) + '...';
                }
            }
        });

        // 6. 最终截断：如果处理完还是很长，强制只取前 15000 个字符
        // 这足够分析语义化，又不会撑爆 Token
        return clone.innerHTML.substring(0, 15000); 
      })()`,
      (result, isException) => {
        if (isException) {
          console.warn('DOM 获取失败', isException);
          // 确保 resolve 的是字符串
          resolve('<error>DOM too large or access denied</error>'); 
        } else {
          // 3. 加上 as string 强制转换
          resolve(String(result || ''));
        }
      }
    );
  });
};