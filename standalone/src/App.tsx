import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { PanelRight } from 'lucide-react';
import { MolvisLogo, type LogoProps } from '../components/Logo';
import { SidebarProvider, useSidebar, ResizableRightSidebar, SidebarContent } from './components/sidebar';
import { useSystemTheme } from './hooks/useSystemTheme';
import { Molvis } from '@molvis/core';
import React from 'react';

// 1. 定义最简单的 MolvisCoreContext
interface MolvisCoreContextValue {
  core: typeof Molvis | null;
  mountPoint: HTMLDivElement | null;
}

const MolvisCoreContext = React.createContext<MolvisCoreContextValue>({
  core: null,
  mountPoint: null,
});

// 简单的MolvisApp组件，挂载一个空的molvis实例
const MolvisApp = ({ children }: { children?: React.ReactNode }) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [core, setCore] = useState<Molvis>(null);

  useEffect(() => {
    if (canvasRef.current) {
      // 创建一个没有内容的molvis实例
      const app = new Molvis(canvasRef.current, {
        fitContainer: true,
        showUI: false,
        debug: false,
      });
      app.start();
      setCore(app);
      // 可选：清理
      return () => app.destroy();
    }
  }, []);

  return (
    <MolvisCoreContext.Provider value={{ core, mountPoint: canvasRef.current }}>
      <div className="flex-1 flex flex-col relative">
        <div
          ref={canvasRef}
          style={{ width: '100%', height: '100%', background: '#f0f4fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          className="molvis-mount-point"
        />
        {children}
      </div>
    </MolvisCoreContext.Provider>
  );
};


const AppContent = () => {
  const { toggleSidebar } = useSidebar();
  const isDark = useSystemTheme();

  return (
    <div className={`flex h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col">
        {/* 顶部工具栏 */}
        <div className={`h-12 border-b flex items-center justify-between px-4 ${
          isDark 
            ? 'bg-gray-800 border-gray-700' 
            : 'bg-white border-gray-200'
        }`}>
          {/* Logo和标题 */}
          <div className="flex items-center space-x-3">
            {/* Logo图标 */}
            <MolvisLogo className="flex-shrink-0" />
            {/* 应用标题 */}
            <h1 className={`text-lg font-semibold ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}>
              Molvis
            </h1>
          </div>

          {/* 右侧按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSidebar}
            className={`$${
              isDark 
                ? 'border-gray-600 text-gray-300 hover:bg-gray-700 hover:border-gray-500' 
                : 'hover:bg-blue-50 hover:border-blue-300'
            }`}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>

        {/* MolVis App区域 */}
        <MolvisApp />
      </div>

      {/* 右侧Sidebar - 作为Overlay */}
      <ResizableRightSidebar>
        <SidebarContent />
      </ResizableRightSidebar>
    </div>
  );
};

const App = () => {
  return (
    <SidebarProvider>
      <AppContent />
    </SidebarProvider>
  );
};

export default App;
export type { LogoProps };
