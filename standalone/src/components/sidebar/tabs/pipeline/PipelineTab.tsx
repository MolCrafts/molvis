import { useState, useCallback } from 'react';
import { Plus, Minus, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSystemTheme } from '../../../../hooks/useSystemTheme';

interface Modifier {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  parameters?: Record<string, unknown>;
}

interface ModifierType {
  id: string;
  name: string;
  description: string;
  category: 'geometry' | 'display' | 'analysis';
}

const MODIFIER_TYPES: ModifierType[] = [
  { id: 'sphere', name: 'Sphere Selection', description: 'Select atoms within a sphere', category: 'geometry' },
  { id: 'box', name: 'Box Selection', description: 'Select atoms within a box', category: 'geometry' },
  { id: 'slice', name: 'Slice', description: 'Create a 2D slice of the structure', category: 'geometry' },
  { id: 'transparency', name: 'Transparency', description: 'Adjust transparency of selected atoms', category: 'display' },
  { id: 'color', name: 'Color Coding', description: 'Color atoms by properties', category: 'display' },
  { id: 'distance', name: 'Distance Measurement', description: 'Measure distances between atoms', category: 'analysis' },
  { id: 'coordination', name: 'Coordination Analysis', description: 'Analyze atomic coordination', category: 'analysis' },
];

export const PipelineTab = () => {
  const isDark = useSystemTheme();
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [selectedModifierId, setSelectedModifierId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const addModifier = useCallback((type: ModifierType) => {
    const newModifier: Modifier = {
      id: `${type.id}_${Date.now()}`,
      type: type.id,
      name: type.name,
      enabled: true,
      parameters: {}
    };
    
    setModifiers(prev => [...prev, newModifier]);
    setSelectedModifierId(newModifier.id);
    setShowAddMenu(false);
  }, []);

  const removeModifier = useCallback(() => {
    if (selectedModifierId) {
      setModifiers(prev => prev.filter(m => m.id !== selectedModifierId));
      setSelectedModifierId(null);
    }
  }, [selectedModifierId]);

  const toggleModifier = useCallback((id: string) => {
    setModifiers(prev => prev.map(m => 
      m.id === id ? { ...m, enabled: !m.enabled } : m
    ));
  }, []);

  const selectModifier = useCallback((id: string) => {
    setSelectedModifierId(prev => prev === id ? null : id);
  }, []);

  const handleOverlayKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setShowAddMenu(false);
    }
  }, []);

  const selectedModifier = modifiers.find(m => m.id === selectedModifierId);

  return (
    <div className="p-4 space-y-6">
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Modifiers
        </h4>
        
        {/* Modifiers Table */}
        <div className={`border rounded-md ${
          isDark ? 'border-gray-600' : 'border-gray-200'
        }`}>
          {modifiers.length === 0 ? (
            <div className={`p-4 text-center text-sm ${
              isDark ? 'text-gray-400' : 'text-gray-600'
            }`}>
              No modifiers added yet
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {modifiers.map((modifier) => (
                <button
                  key={modifier.id}
                  type="button"
                  className={`w-full p-3 text-left transition-colors ${
                    selectedModifierId === modifier.id
                      ? isDark
                        ? 'bg-blue-900/50 border-blue-400'
                        : 'bg-blue-50 border-blue-200'
                      : isDark
                        ? 'hover:bg-gray-700'
                        : 'hover:bg-gray-50'
                  } ${selectedModifierId === modifier.id ? 'border-l-2' : ''}`}
                  onClick={() => selectModifier(modifier.id)}
                >
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={modifier.enabled}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleModifier(modifier.id);
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className={`text-sm font-medium ${
                        isDark ? 'text-white' : 'text-gray-900'
                      }`}>
                        {modifier.name}
                      </div>
                      <div className={`text-xs ${
                        isDark ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        {modifier.type}
                      </div>
                    </div>
                    <div className={`text-xs px-2 py-1 rounded ${
                      modifier.enabled
                        ? isDark
                          ? 'bg-green-900 text-green-300'
                          : 'bg-green-100 text-green-700'
                        : isDark
                          ? 'bg-gray-700 text-gray-400'
                          : 'bg-gray-100 text-gray-500'
                    }`}>
                      {modifier.enabled ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between mt-3">
          <div className="flex space-x-2">
            {/* Add Button with Dropdown */}
            <div className="relative">
              <Button
                size="sm"
                onClick={() => setShowAddMenu(!showAddMenu)}
                className={`flex items-center space-x-1 ${
                  isDark 
                    ? 'bg-green-700 hover:bg-green-600 text-white' 
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                <Plus className="h-4 w-4" />
                <span>Add</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
              
              {/* Dropdown Menu */}
              {showAddMenu && (
                <div className={`absolute top-full left-0 mt-1 w-64 border rounded-md shadow-lg z-10 ${
                  isDark 
                    ? 'bg-gray-800 border-gray-600' 
                    : 'bg-white border-gray-200'
                }`}>
                  <div className="py-1">
                    {Object.entries(
                      MODIFIER_TYPES.reduce((acc, type) => {
                        if (!acc[type.category]) acc[type.category] = [];
                        acc[type.category].push(type);
                        return acc;
                      }, {} as Record<string, ModifierType[]>)
                    ).map(([category, types]) => (
                      <div key={category}>
                        <div className={`px-3 py-2 text-xs font-medium uppercase tracking-wide ${
                          isDark ? 'text-gray-400 bg-gray-750' : 'text-gray-500 bg-gray-50'
                        }`}>
                          {category}
                        </div>
                        {types.map((type) => (
                          <button
                            key={type.id}
                            type="button"
                            onClick={() => addModifier(type)}
                            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                              isDark 
                                ? 'text-gray-200 hover:bg-gray-700' 
                                : 'text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            <div className="font-medium">{type.name}</div>
                            <div className={`text-xs ${
                              isDark ? 'text-gray-400' : 'text-gray-500'
                            }`}>
                              {type.description}
                            </div>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Remove Button */}
            <Button
              size="sm"
              variant="outline"
              onClick={removeModifier}
              disabled={!selectedModifierId}
              className={`flex items-center space-x-1 ${
                !selectedModifierId 
                  ? 'opacity-50 cursor-not-allowed' 
                  : isDark
                    ? 'border-red-600 text-red-400 hover:bg-red-900/20'
                    : 'border-red-300 text-red-600 hover:bg-red-50'
              }`}
            >
              <Minus className="h-4 w-4" />
              <span>Remove</span>
            </Button>
          </div>

          <div className={`text-xs ${
            isDark ? 'text-gray-400' : 'text-gray-500'
          }`}>
            {modifiers.length} modifier{modifiers.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Selected Modifier Details Card */}
        {selectedModifier && (
          <div className={`mt-4 p-4 border rounded-md ${
            isDark 
              ? 'bg-gray-800 border-gray-600' 
              : 'bg-gray-50 border-gray-200'
          }`}>
            <h5 className={`text-sm font-medium mb-3 ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}>
              {selectedModifier.name} Settings
            </h5>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label 
                  htmlFor={`enabled-${selectedModifier.id}`}
                  className={`text-sm ${
                    isDark ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  Enabled
                </label>
                <input
                  id={`enabled-${selectedModifier.id}`}
                  type="checkbox"
                  checked={selectedModifier.enabled}
                  onChange={() => toggleModifier(selectedModifier.id)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label 
                  htmlFor={`name-${selectedModifier.id}`}
                  className={`block text-sm mb-1 ${
                    isDark ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  Name
                </label>
                <input
                  id={`name-${selectedModifier.id}`}
                  type="text"
                  value={selectedModifier.name}
                  onChange={(e) => {
                    setModifiers(prev => prev.map(m => 
                      m.id === selectedModifier.id ? { ...m, name: e.target.value } : m
                    ));
                  }}
                  className={`w-full px-3 py-2 text-sm border rounded-md ${
                    isDark 
                      ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                />
              </div>

              <div>
                <label 
                  htmlFor={`type-${selectedModifier.id}`}
                  className={`block text-sm mb-1 ${
                    isDark ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  Type
                </label>
                <div 
                  id={`type-${selectedModifier.id}`}
                  className={`px-3 py-2 text-sm border rounded-md ${
                    isDark 
                      ? 'bg-gray-700 border-gray-600 text-gray-300' 
                      : 'bg-gray-100 border-gray-300 text-gray-600'
                  }`}
                >
                  {selectedModifier.type}
                </div>
              </div>

              {/* Modifier-specific parameters would go here */}
              <div className={`text-xs ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Additional parameters for this modifier type will be available here.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Click outside to close dropdown */}
      {showAddMenu && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowAddMenu(false)}
          onKeyDown={handleOverlayKeyDown}
          role="button"
          tabIndex={0}
          aria-label="Close dropdown menu"
        />
      )}
    </div>
  );
};
