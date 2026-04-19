// 封装 获取选中元素 CSS 样式 
export const getCSS = (): Promise<Record<string, string> | null> => {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(
      `(function () {
        if (!$0) return null;
        const style = window.getComputedStyle($0);
        const keys = [
          'color',
          'backgroundColor',
          'fontSize',
          'fontWeight',
          'margin',
          'marginTop',
          'marginRight',
          'marginBottom',
          'marginLeft',
          'padding',
          'paddingTop',
          'paddingRight',
          'paddingBottom',
          'paddingLeft',
          'display',
          'position',
          'width',
          'height'
        ];
        const result = {};
        keys.forEach(k => { result[k] = style[k]; });
        return result;
      })()`,
      (result: unknown, exceptionInfo: unknown) => {
        const ex = exceptionInfo as { isException?: boolean } | null;
        if (ex && ex.isException) {
          console.warn('getCSS exception', ex);
          resolve(null);
          return;
        }

        if (result && typeof result === 'object') {
          resolve(result as Record<string, string>);
        } else {
          resolve(null);
        }
      }
    );
  });
};