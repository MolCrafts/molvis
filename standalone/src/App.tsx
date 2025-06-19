import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { PanelRight, X } from 'lucide-react';
import { Molvis } from '@molvis/core';
import { MolvisLogo, type LogoProps } from '../components/Logo';

// 自定义hook来检测系统主题
const useSystemTheme = () => {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isDark;
};

// 创建简单的Sidebar上下文
type SidebarContextType = {
  isOpen: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextType | null>(null);

const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return context;
};

// 简化的SidebarProvider，只管理状态，不渲染UI
const SidebarProvider = ({ children }: { children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  const toggleSidebar = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  return (
    <SidebarContext.Provider value={{ isOpen, toggleSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
};

// 可调节宽度的右侧Sidebar组件
const ResizableRightSidebar = ({ children }: { children: React.ReactNode }) => {
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

// Sidebar内容组件
const SidebarContent = () => {
  const isDark = useSystemTheme();
  
  return (
    <div className="p-4 space-y-6">
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Molecule Properties
        </h4>
        <div className="space-y-2">
          <div className="text-sm">
            <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Formula:</span>
            <span className={`ml-2 ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>H₂O</span>
          </div>
          <div className="text-sm">
            <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Atoms:</span>
            <span className={`ml-2 ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>3</span>
          </div>
          <div className="text-sm">
            <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Bonds:</span>
            <span className={`ml-2 ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>2</span>
          </div>
        </div>
      </div>

      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Visualization
        </h4>
        <div className="space-y-3">
          <label className="flex items-center">
            <input type="checkbox" className="rounded" defaultChecked />
            <span className={`ml-2 text-sm ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Show atoms
            </span>
          </label>
          <label className="flex items-center">
            <input type="checkbox" className="rounded" defaultChecked />
            <span className={`ml-2 text-sm ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Show bonds
            </span>
          </label>
          <label className="flex items-center">
            <input type="checkbox" className="rounded" />
            <span className={`ml-2 text-sm ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Show labels
            </span>
          </label>
        </div>
      </div>

      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Settings
        </h4>
        <div className="space-y-3">
          <div>
            <label 
              htmlFor="atom-size" 
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Atom size
            </label>
            <input 
              id="atom-size"
              type="range" 
              min="0.1" 
              max="2" 
              step="0.1" 
              defaultValue="1"
              className="w-full"
            />
          </div>
          <div>
            <label 
              htmlFor="bond-thickness" 
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Bond thickness
            </label>
            <input 
              id="bond-thickness"
              type="range" 
              min="0.1" 
              max="1" 
              step="0.1" 
              defaultValue="0.2"
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// MolVis App组件
const MolvisApp = ({ children }: { children?: React.ReactNode }) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<{ destroy: () => void; resize?: () => void } | null>(null);
  const isInitializedRef = useRef(false);

  // 初始化Molvis实例
  const initializeMolvis = useCallback(() => {
    console.log('[MolvisApp] Attempting to initialize Molvis...');
    
    if (!canvasRef.current) {
      console.warn('[MolvisApp] Canvas ref is null, cannot initialize');
      return;
    }
    
    if (isInitializedRef.current || appRef.current) {
      console.warn('[MolvisApp] Molvis already initialized');
      return;
    }

    try {
      const mountPoint = canvasRef.current;
      console.log('[MolvisApp] Initializing Molvis with mount point:', mountPoint);
      
      const app = new Molvis(mountPoint, {
        fitContainer: true,
        showUI: true,
        uiComponents: {
          showModeIndicator: true,
          showViewIndicator: true,
          showInfoPanel: true,
          showFrameIndicator: true
        },
        debug: true
      });
      app.start();
      appRef.current = app;
      isInitializedRef.current = true;
      console.log('[MolvisApp] Molvis initialized successfully');
    } catch (error) {
      console.error('[MolvisApp] Failed to initialize Molvis:', error);
    }
  }, []);

  // 清理Molvis实例
  const destroyMolvis = useCallback(() => {
    console.log('[MolvisApp] Destroying Molvis...');
    
    if (appRef.current) {
      try {
        appRef.current.destroy();
        console.log('[MolvisApp] Molvis destroyed successfully');
      } catch (error) {
        console.error('[MolvisApp] Error destroying Molvis:', error);
      }
      appRef.current = null;
    }
    
    isInitializedRef.current = false;
  }, []);

  useEffect(() => {
    console.log('[MolvisApp] Component mounted');
    
    initializeMolvis();

    return () => {
      console.log('[MolvisApp] Component will unmount');
      destroyMolvis();
    };
  }, [initializeMolvis, destroyMolvis]);

  // 处理窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      appRef.current?.resize?.();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex-1 flex flex-col relative">
      {/* MolVis Canvas */}
      <div 
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
        className="molvis-mount-point"
      />
      
      {/* Children overlay */}
      {children}
    </div>
  );
};

// 主应用组件
const AppContent = ({ LogoComponent }: { LogoComponent?: React.ComponentType<LogoProps> }) => {
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
            className={`${
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

const App = ({ LogoComponent }: { LogoComponent?: React.ComponentType<LogoProps> } = {}) => {
  return (
    <SidebarProvider>
      <AppContent LogoComponent={LogoComponent} />
    </SidebarProvider>
  );
};

export default App;
export type { LogoProps };
