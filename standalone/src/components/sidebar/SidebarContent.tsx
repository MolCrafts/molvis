import { useState } from 'react';
import { useSystemTheme } from '../../hooks/useSystemTheme';
import { useMolvisCore } from '../../hooks/useMolvisCore';
import { PipelineTab, ViewTab, EditTab, SettingsTab } from './tabs';
import { Workflow, Eye, Edit, Settings } from 'lucide-react';
import { ModeType } from '@molvis/core';
import { Logger } from 'tslog';

// Create logger instance
const logger = new Logger({
  name: 'SidebarContent',
  minLevel: 0, // 0 = SILLY, 1 = TRACE, 2 = DEBUG, 3 = INFO, 4 = WARN, 5 = ERROR, 6 = FATAL
});

export const SidebarContent = () => {
  const isDark = useSystemTheme();
  const [activeTab, setActiveTab] = useState('pipeline');
  const { core } = useMolvisCore();
  
  const tabs = [
    { id: 'pipeline', label: 'Pipeline', icon: Workflow },
    { id: 'view', label: 'View', icon: Eye },
    { id: 'edit', label: 'Edit', icon: Edit },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  // Handle tab change and switch core mode accordingly
  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    
    // Switch core mode based on selected tab
    if (tabId === 'edit') {
      core.mode.switch_mode(ModeType.Edit);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className={`flex border-b ${
        isDark ? 'border-gray-700' : 'border-gray-200'
      }`}>
        {tabs.map((tab) => {
          const IconComponent = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === tab.id
                  ? isDark
                    ? 'text-white border-b-2 border-blue-400 bg-gray-800'
                    : 'text-gray-900 border-b-2 border-blue-500 bg-white'
                  : isDark
                    ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <IconComponent className="h-4 w-4" />
            </button>
          );
        })}
      </div>

      {/* Tab content area */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'pipeline' && <PipelineTab />}
        {activeTab === 'view' && <ViewTab />}
        {activeTab === 'edit' && <EditTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
};
