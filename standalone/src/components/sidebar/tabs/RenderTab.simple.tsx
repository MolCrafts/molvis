import { useState } from 'react';
import { useSystemTheme } from '../../../hooks/useSystemTheme';

export const RenderTab = () => {
  const isDark = useSystemTheme();

  return (
    <div className="p-4 space-y-6">
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Render Settings
        </h4>
        <div className="space-y-3">
          <div>
            <label className={`block text-sm mb-1 ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Background Color
            </label>
            <input
              type="color"
              defaultValue="#000000"
              className="w-8 h-8 rounded border border-gray-300"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
