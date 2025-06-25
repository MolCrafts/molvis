import { Button } from '@/components/ui/button';
import { PanelRight } from 'lucide-react';
import { MolvisLogo, type LogoProps } from '../components/Logo';
import { SidebarProvider, useSidebar, ResizableRightSidebar, SidebarContent } from './components/sidebar';
import { useSystemTheme } from './hooks/useSystemTheme';
import { MolvisCoreProvider, MolvisCanvas } from './hooks/useMolvisCore';

// Main application component
const AppContent = () => {
  const { toggleSidebar } = useSidebar();
  const isDark = useSystemTheme();

  return (
    <div className={`flex h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      {/* Main content area */}
      <div className="flex-1 flex flex-col relative">
        {/* Top toolbar */}
        <div className={`h-12 border-b flex items-center justify-between px-4 relative z-10 ${
          isDark 
            ? 'bg-gray-800 border-gray-700' 
            : 'bg-white border-gray-200'
        }`}>
          {/* Logo and title */}
          <div className="flex items-center space-x-3">
            {/* Logo icon */}
            <MolvisLogo className="flex-shrink-0" />
            {/* Application title */}
            <h1 className={`text-lg font-semibold ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}>
              Molvis
            </h1>
          </div>

          {/* Right side button */}
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

        {/* Canvas area */}
        <div className="flex-1 relative z-0">
          <MolvisCanvas />
        </div>
        
        {/* Right sidebar - as overlay */}
        <ResizableRightSidebar>
          <SidebarContent />
        </ResizableRightSidebar>
      </div>
    </div>
  );
};

const App = () => {
  return (
    <SidebarProvider>
      <MolvisCoreProvider>
        <AppContent />
      </MolvisCoreProvider>
    </SidebarProvider>
  );
};

export default App;
export type { LogoProps };
