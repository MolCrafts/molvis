export function preventEventPropagation(element: HTMLElement) {
  // 只阻止右键菜单，保留其他交互
  element.addEventListener("contextmenu", (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  }, false);
  
  // 对于其他事件，只在必要时阻止冒泡到Jupyter，但不阻止widget内部处理
  const conditionalStop = (e: Event) => {
    // 如果事件目标是canvas或widget内部元素，让widget先处理
    const target = e.target as HTMLElement;
    if (target && (
      target.tagName === 'CANVAS' || 
      target.classList.contains('molvis-canvas') ||
      target.closest('[id^="molvis-widget-"]')
    )) {
      // widget内部事件，不阻止，让widget处理
      return;
    }
    // 其他情况才阻止冒泡到Jupyter
    e.stopPropagation();
  };
  
  // 只对可能干扰Jupyter的事件进行条件性阻止
  for (const eventType of ["keydown", "keyup", "keypress"]) {
    element.addEventListener(eventType, conditionalStop, false);
  }
} 