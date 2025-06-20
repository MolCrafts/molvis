import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useSidebar } from './SidebarContext';
import { useSystemTheme } from '../../hooks/useSystemTheme';

interface ResizableRightSidebarProps {
  children: React.ReactNode;
}

export const ResizableRightSidebar = ({ children }: ResizableRightSidebarProps) => {
  const [width, setWidth] = useState(320); // 默认宽度320px
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const { isOpen, toggleSidebar } = useSidebar();
  const isDark = useSystemTheme();

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResize = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing && sidebarRef.current) {
      const newWidth = window.innerWidth - e.clientX;
      // 限制最小和最大宽度
      const clampedWidth = Math.max(200, Math.min(600, newWidth));
      setWidth(clampedWidth);
    }
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', stopResize);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, resize, stopResize]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={sidebarRef}
      className={`fixed right-0 top-0 h-full border-l shadow-lg z-50 flex ${
        isDark 
          ? 'bg-gray-800 border-gray-700' 
          : 'bg-white border-gray-200'
      }`}
      style={{ width: `${width}px` }}
    >
      {/* 左侧拖拽手柄 */}
      <div
        className={`w-2 cursor-col-resize flex-shrink-0 transition-colors relative group ${
          isDark 
            ? 'bg-gray-700 hover:bg-blue-600' 
            : 'bg-gray-300 hover:bg-blue-500'
        }`}
        onMouseDown={startResize}
      >
        {/* 拖拽指示线 */}
        <div className={`absolute inset-y-0 left-1/2 w-0.5 transition-colors ${
          isDark 
            ? 'bg-gray-600 group-hover:bg-blue-500' 
            : 'bg-gray-400 group-hover:bg-blue-600'
        }`} />
      </div>
      
      {/* Sidebar内容 */}
      <div className="flex-1 flex flex-col">
        {/* 顶部标题栏 */}
        <div className={`h-12 border-b flex items-center justify-between px-4 ${
          isDark 
            ? 'bg-gray-750 border-gray-700' 
            : 'bg-gray-50 border-gray-200'
        }`}>
          <h3 className={`font-medium ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>
            Properties
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className={`h-8 w-8 p-0 ${
              isDark 
                ? 'text-gray-400 hover:text-white hover:bg-gray-700' 
                : 'hover:bg-gray-100'
            }`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* 内容区域 */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
};
