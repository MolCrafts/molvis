import { useState } from 'react';
import { Plus, Minus, Edit3, Atom, Link } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSystemTheme } from '../../../../hooks/useSystemTheme';
import { useMolvisCore } from '../../../../hooks/useMolvisCore';

// Chemical element data
const PERIODIC_TABLE = [
  // Period 1
  { symbol: 'H', name: 'Hydrogen', number: 1, group: 1, period: 1, color: '#ffffff' },
  { symbol: 'He', name: 'Helium', number: 2, group: 18, period: 1, color: '#d9ffff' },
  
  // Period 2
  { symbol: 'Li', name: 'Lithium', number: 3, group: 1, period: 2, color: '#cc80ff' },
  { symbol: 'Be', name: 'Beryllium', number: 4, group: 2, period: 2, color: '#c2ff00' },
  { symbol: 'B', name: 'Boron', number: 5, group: 13, period: 2, color: '#ffb5b5' },
  { symbol: 'C', name: 'Carbon', number: 6, group: 14, period: 2, color: '#909090' },
  { symbol: 'N', name: 'Nitrogen', number: 7, group: 15, period: 2, color: '#3050f8' },
  { symbol: 'O', name: 'Oxygen', number: 8, group: 16, period: 2, color: '#ff0d0d' },
  { symbol: 'F', name: 'Fluorine', number: 9, group: 17, period: 2, color: '#90e050' },
  { symbol: 'Ne', name: 'Neon', number: 10, group: 18, period: 2, color: '#b3e3f5' },
  
  // Period 3
  { symbol: 'Na', name: 'Sodium', number: 11, group: 1, period: 3, color: '#ab5cf2' },
  { symbol: 'Mg', name: 'Magnesium', number: 12, group: 2, period: 3, color: '#8aff00' },
  { symbol: 'Al', name: 'Aluminum', number: 13, group: 13, period: 3, color: '#bfa6a6' },
  { symbol: 'Si', name: 'Silicon', number: 14, group: 14, period: 3, color: '#f0c8a0' },
  { symbol: 'P', name: 'Phosphorus', number: 15, group: 15, period: 3, color: '#ff8000' },
  { symbol: 'S', name: 'Sulfur', number: 16, group: 16, period: 3, color: '#ffff30' },
  { symbol: 'Cl', name: 'Chlorine', number: 17, group: 17, period: 3, color: '#1ff01f' },
  { symbol: 'Ar', name: 'Argon', number: 18, group: 18, period: 3, color: '#80d1e3' },
  
  // More common elements
  { symbol: 'K', name: 'Potassium', number: 19, group: 1, period: 4, color: '#8f40d4' },
  { symbol: 'Ca', name: 'Calcium', number: 20, group: 2, period: 4, color: '#3dff00' },
  { symbol: 'Fe', name: 'Iron', number: 26, group: 8, period: 4, color: '#e06633' },
  { symbol: 'Cu', name: 'Copper', number: 29, group: 11, period: 4, color: '#c88033' },
  { symbol: 'Zn', name: 'Zinc', number: 30, group: 12, period: 4, color: '#7d80b0' },
  { symbol: 'Br', name: 'Bromine', number: 35, group: 17, period: 4, color: '#a62929' },
  { symbol: 'I', name: 'Iodine', number: 53, group: 17, period: 5, color: '#940094' },
];

interface AtomProperty {
  id: string;
  name: string;
  value: string | number;
  type: 'string' | 'number' | 'boolean';
}

interface BondProperty {
  id: string;
  name: string;
  value: string | number;
  type: 'string' | 'number' | 'boolean';
}

export const EditTab = () => {
  const isDark = useSystemTheme();
  const [selectedElement, setSelectedElement] = useState<typeof PERIODIC_TABLE[0] | null>(null);
  const [showPeriodicTable, setShowPeriodicTable] = useState(false);
  const [atomProperties, setAtomProperties] = useState<AtomProperty[]>([
    { id: '1', name: 'charge', value: 0, type: 'number' },
    { id: '2', name: 'mass', value: 12.01, type: 'number' },
    { id: '3', name: 'label', value: '', type: 'string' },
  ]);
  const [bondProperties, setBondProperties] = useState<BondProperty[]>([
    { id: '1', name: 'order', value: 1, type: 'number' },
    { id: '2', name: 'length', value: 1.5, type: 'number' },
    { id: '3', name: 'type', value: 'single', type: 'string' },
  ]);

  const addAtomProperty = () => {
    const newProperty: AtomProperty = {
      id: Date.now().toString(),
      name: 'new_property',
      value: '',
      type: 'string'
    };
    setAtomProperties(prev => [...prev, newProperty]);
  };

  const removeAtomProperty = (id: string) => {
    setAtomProperties(prev => prev.filter(p => p.id !== id));
  };

  const updateAtomProperty = (id: string, field: keyof AtomProperty, value: string | number | boolean) => {
    setAtomProperties(prev => prev.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  const addBondProperty = () => {
    const newProperty: BondProperty = {
      id: Date.now().toString(),
      name: 'new_property',
      value: '',
      type: 'string'
    };
    setBondProperties(prev => [...prev, newProperty]);
  };

  const removeBondProperty = (id: string) => {
    setBondProperties(prev => prev.filter(p => p.id !== id));
  };

  const updateBondProperty = (id: string, field: keyof BondProperty, value: string | number | boolean) => {
    setBondProperties(prev => prev.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  };

  return (
    <div className="p-4 space-y-6">
      {/* Element Selection */}
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          <Atom className="inline-block w-4 h-4 mr-2" />
          Element Selection
        </h4>
        
        <div className="space-y-3">
          <div className="flex items-center space-x-3">
            {selectedElement && (
              <div 
                className="w-12 h-12 rounded border-2 flex items-center justify-center text-sm font-bold"
                style={{ 
                  backgroundColor: selectedElement.color,
                  borderColor: isDark ? '#374151' : '#d1d5db',
                  color: selectedElement.color === '#ffffff' || selectedElement.color === '#ffff30' ? '#000' : '#fff'
                }}
              >
                {selectedElement.symbol}
              </div>
            )}
            
            <div className="flex-1">
              <Button
                onClick={() => setShowPeriodicTable(!showPeriodicTable)}
                className={`w-full ${
                  isDark 
                    ? 'bg-blue-700 hover:bg-blue-600 text-white' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {selectedElement ? `${selectedElement.name} (${selectedElement.symbol})` : 'Select Element'}
              </Button>
            </div>
          </div>

          {showPeriodicTable && (
            <div className={`border rounded-lg p-4 ${
              isDark ? 'border-gray-600 bg-gray-800' : 'border-gray-200 bg-gray-50'
            }`}>
              <div className="grid grid-cols-6 gap-1 text-xs">
                {PERIODIC_TABLE.map((element) => (
                  <button
                    key={element.symbol}
                    type="button"
                    onClick={() => {
                      setSelectedElement(element);
                      setShowPeriodicTable(false);
                    }}
                    className={`w-8 h-8 rounded border text-xs font-bold transition-all hover:scale-105 ${
                      selectedElement?.symbol === element.symbol 
                        ? 'ring-2 ring-blue-500' 
                        : ''
                    }`}
                    style={{ 
                      backgroundColor: element.color,
                      borderColor: isDark ? '#374151' : '#d1d5db',
                      color: element.color === '#ffffff' || element.color === '#ffff30' ? '#000' : '#fff'
                    }}
                    title={`${element.name} (${element.number})`}
                  >
                    {element.symbol}
                  </button>
                ))}
              </div>
              
              <div className="mt-2 text-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowPeriodicTable(false)}
                  className={`${
                    isDark 
                      ? 'border-gray-600 text-gray-300 hover:bg-gray-700' 
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Atom Properties */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className={`text-sm font-medium ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>
            <Edit3 className="inline-block w-4 h-4 mr-2" />
            Atom Properties
          </h4>
          <Button
            size="sm"
            onClick={addAtomProperty}
            className={`${
              isDark 
                ? 'bg-green-700 hover:bg-green-600 text-white' 
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            <Plus className="w-3 h-3 mr-1" />
            Add
          </Button>
        </div>

        <div className="space-y-2">
          {atomProperties.map((property) => (
            <div 
              key={property.id}
              className={`flex items-center space-x-2 p-2 border rounded ${
                isDark 
                  ? 'border-gray-600 bg-gray-700' 
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <input
                type="text"
                value={property.name}
                onChange={(e) => updateAtomProperty(property.id, 'name', e.target.value)}
                className={`flex-1 px-2 py-1 text-sm border rounded ${
                  isDark 
                    ? 'bg-gray-600 border-gray-500 text-white' 
                    : 'bg-white border-gray-300 text-gray-900'
                }`}
                placeholder="Property name"
              />
              
              <select
                value={property.type}
                onChange={(e) => updateAtomProperty(property.id, 'type', e.target.value as 'string' | 'number' | 'boolean')}
                className={`px-2 py-1 text-sm border rounded ${
                  isDark 
                    ? 'bg-gray-600 border-gray-500 text-white' 
                    : 'bg-white border-gray-300 text-gray-900'
                }`}
              >
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
              </select>
              
              {property.type === 'string' && (
                <input
                  type="text"
                  value={property.value as string}
                  onChange={(e) => updateAtomProperty(property.id, 'value', e.target.value)}
                  className={`flex-1 px-2 py-1 text-sm border rounded ${
                    isDark 
                      ? 'bg-gray-600 border-gray-500 text-white' 
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                  placeholder="Value"
                />
              )}
              
              {property.type === 'number' && (
                <input
                  type="number"
                  value={property.value as number}
                  onChange={(e) => updateAtomProperty(property.id, 'value', Number.parseFloat(e.target.value) || 0)}
                  className={`flex-1 px-2 py-1 text-sm border rounded ${
                    isDark 
                      ? 'bg-gray-600 border-gray-500 text-white' 
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                  step="any"
                />
              )}
              
              {property.type === 'boolean' && (
                <input
                  type="checkbox"
                  checked={Boolean(property.value)}
                  onChange={(e) => updateAtomProperty(property.id, 'value', e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              )}
              
              <Button
                size="sm"
                variant="outline"
                onClick={() => removeAtomProperty(property.id)}
                className={`p-1 ${
                  isDark
                    ? 'border-red-600 text-red-400 hover:bg-red-900/20'
                    : 'border-red-300 text-red-600 hover:bg-red-50'
                }`}
              >
                <Minus className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Bond Properties */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className={`text-sm font-medium ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>
            <Link className="inline-block w-4 h-4 mr-2" />
            Bond Properties
          </h4>
          <Button
            size="sm"
            onClick={addBondProperty}
            className={`${
              isDark 
                ? 'bg-green-700 hover:bg-green-600 text-white' 
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            <Plus className="w-3 h-3 mr-1" />
            Add
          </Button>
        </div>

        <div className="space-y-2">
          {bondProperties.map((property) => (
            <div 
              key={property.id}
              className={`flex items-center space-x-2 p-2 border rounded ${
                isDark 
                  ? 'border-gray-600 bg-gray-700' 
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <input
                type="text"
                value={property.name}
                onChange={(e) => updateBondProperty(property.id, 'name', e.target.value)}
                className={`flex-1 px-2 py-1 text-sm border rounded ${
                  isDark 
                    ? 'bg-gray-600 border-gray-500 text-white' 
                    : 'bg-white border-gray-300 text-gray-900'
                }`}
                placeholder="Property name"
              />
              
              <select
                value={property.type}
                onChange={(e) => updateBondProperty(property.id, 'type', e.target.value as 'string' | 'number' | 'boolean')}
                className={`px-2 py-1 text-sm border rounded ${
                  isDark 
                    ? 'bg-gray-600 border-gray-500 text-white' 
                    : 'bg-white border-gray-300 text-gray-900'
                }`}
              >
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
              </select>
              
              {property.type === 'string' && (
                <input
                  type="text"
                  value={property.value as string}
                  onChange={(e) => updateBondProperty(property.id, 'value', e.target.value)}
                  className={`flex-1 px-2 py-1 text-sm border rounded ${
                    isDark 
                      ? 'bg-gray-600 border-gray-500 text-white' 
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                  placeholder="Value"
                />
              )}
              
              {property.type === 'number' && (
                <input
                  type="number"
                  value={property.value as number}
                  onChange={(e) => updateBondProperty(property.id, 'value', Number.parseFloat(e.target.value) || 0)}
                  className={`flex-1 px-2 py-1 text-sm border rounded ${
                    isDark 
                      ? 'bg-gray-600 border-gray-500 text-white' 
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                  step="any"
                />
              )}
              
              {property.type === 'boolean' && (
                <input
                  type="checkbox"
                  checked={Boolean(property.value)}
                  onChange={(e) => updateBondProperty(property.id, 'value', e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              )}
              
              <Button
                size="sm"
                variant="outline"
                onClick={() => removeBondProperty(property.id)}
                className={`p-1 ${
                  isDark
                    ? 'border-red-600 text-red-400 hover:bg-red-900/20'
                    : 'border-red-300 text-red-600 hover:bg-red-50'
                }`}
              >
                <Minus className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Element Info */}
      {selectedElement && (
        <div className={`p-3 border rounded-lg ${
          isDark ? 'border-gray-600 bg-gray-800' : 'border-gray-200 bg-gray-50'
        }`}>
          <h5 className={`text-sm font-medium mb-2 ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>
            Selected Element
          </h5>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className={`font-medium ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Name:
              </span>
              <span className={`ml-2 ${
                isDark ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {selectedElement.name}
              </span>
            </div>
            <div>
              <span className={`font-medium ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Number:
              </span>
              <span className={`ml-2 ${
                isDark ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {selectedElement.number}
              </span>
            </div>
            <div>
              <span className={`font-medium ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Group:
              </span>
              <span className={`ml-2 ${
                isDark ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {selectedElement.group}
              </span>
            </div>
            <div>
              <span className={`font-medium ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Period:
              </span>
              <span className={`ml-2 ${
                isDark ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {selectedElement.period}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
