import { useSystemTheme } from '../../../hooks/useSystemTheme';

export const SettingsTab = () => {
  const isDark = useSystemTheme();

  return (
    <div className="p-4 space-y-6">
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
