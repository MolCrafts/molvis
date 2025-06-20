import { useState } from 'react';
import { useSystemTheme } from '../../hooks/useSystemTheme';
import { PipelineTab, RenderTab, EditTab, SettingsTab } from './tabs';

export const SidebarContent = () => {
  const isDark = useSystemTheme();
  const [activeTab, setActiveTab] = useState('pipeline');
  
  const tabs = [
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'render', label: 'Render' },
    { id: 'edit', label: 'Edit' },
    { id: 'settings', label: 'Settings' }
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tab栏 */}
      <div className={`flex border-b ${
        isDark ? 'border-gray-700' : 'border-gray-200'
      }`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? isDark
                  ? 'text-white border-b-2 border-blue-400 bg-gray-800'
                  : 'text-gray-900 border-b-2 border-blue-500 bg-white'
                : isDark
                  ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab内容区域 */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'pipeline' && <PipelineTab />}
        {activeTab === 'render' && <RenderTab />}
        {activeTab === 'edit' && <EditTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
};
