import { useSystemTheme } from '../../../../hooks/useSystemTheme';

export const SettingsTab = () => {
  const isDark = useSystemTheme();

  return (
    <div className="p-4">
      <div className={`space-y-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        <h3 className="text-lg font-semibold">Settings</h3>
        
        <div className="space-y-3">
          <div>
            <label className={`block text-sm font-medium mb-1 ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Theme
            </label>
            <select 
              className={`w-full p-2 rounded border ${
                isDark 
                  ? 'bg-gray-700 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            >
              <option>Auto</option>
              <option>Light</option>
              <option>Dark</option>
            </select>
          </div>
          
          <div>
            <label className={`block text-sm font-medium mb-1 ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Performance
            </label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input type="checkbox" className="mr-2" defaultChecked />
                <span className="text-sm">Enable hardware acceleration</span>
              </label>
              <label className="flex items-center">
                <input type="checkbox" className="mr-2" />
                <span className="text-sm">High quality rendering</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
