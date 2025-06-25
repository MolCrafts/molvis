import { useState } from 'react';
import { useSystemTheme } from '../../../../hooks/useSystemTheme';

interface RenderSettings {
  backgroundColor: string;
  showAxes: boolean;
  showBoundingBox: boolean;
  particleShape: string;
  particleSize: number;
  particleTransparency: number;
  showBonds: boolean;
  bondWidth: number;
  bondTransparency: number;
  ambientLight: number;
  diffuseLight: number;
  specularLight: number;
  shininess: number;
  cameraType: string;
  fieldOfView: number;
  antialiasing: boolean;
  shadows: boolean;
  reflections: boolean;
  imageWidth: number;
  imageHeight: number;
  imageFormat: string;
}

export const ViewTab = () => {
  const isDark = useSystemTheme();
  const [renderSettings, setRenderSettings] = useState<RenderSettings>({
    // Viewport settings
    backgroundColor: '#000000',
    showAxes: false,
    showBoundingBox: false,
    
    // Particle display
    particleShape: 'sphere',
    particleSize: 1.0,
    particleTransparency: 0.0,
    
    // Bond display
    showBonds: true,
    bondWidth: 0.3,
    bondTransparency: 0.0,
    
    // Lighting
    ambientLight: 0.4,
    diffuseLight: 0.8,
    specularLight: 0.6,
    shininess: 30,
    
    // Camera
    cameraType: 'perspective',
    fieldOfView: 45,
    
    // Rendering quality
    antialiasing: true,
    shadows: false,
    reflections: false,
    
    // Output
    imageWidth: 1920,
    imageHeight: 1080,
    imageFormat: 'png'
  });

  const updateSetting = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) => {
    setRenderSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-4 space-y-6">
      {/* Viewport Settings */}
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Viewport
        </h4>
        <div className="space-y-3">
          <div>
            <label 
              htmlFor="background-color"
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Background Color
            </label>
            <div className="flex items-center space-x-2">
              <input
                id="background-color"
                type="color"
                value={renderSettings.backgroundColor}
                onChange={(e) => updateSetting('backgroundColor', e.target.value)}
                className="w-8 h-8 rounded border border-gray-300"
              />
              <span className={`text-sm ${
                isDark ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {renderSettings.backgroundColor}
              </span>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={renderSettings.showAxes}
                onChange={(e) => updateSetting('showAxes', e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className={`ml-2 text-sm ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Show coordinate axes
              </span>
            </label>
            
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={renderSettings.showBoundingBox}
                onChange={(e) => updateSetting('showBoundingBox', e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className={`ml-2 text-sm ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Show bounding box
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Particle Display */}
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Particles
        </h4>
        <div className="space-y-3">
          <div>
            <label 
              htmlFor="particle-shape"
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Shape
            </label>
            <select
              id="particle-shape"
              value={renderSettings.particleShape}
              onChange={(e) => updateSetting('particleShape', e.target.value)}
              className={`w-full px-3 py-2 text-sm border rounded-md ${
                isDark 
                  ? 'bg-gray-700 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            >
              <option value="sphere">Sphere</option>
              <option value="cube">Cube</option>
              <option value="cylinder">Cylinder</option>
              <option value="icosahedron">Icosahedron</option>
            </select>
          </div>
          
          <div>
            <label 
              htmlFor="particle-size"
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Size: {renderSettings.particleSize.toFixed(1)}
            </label>
            <input
              id="particle-size"
              type="range"
              min="0.1"
              max="3.0"
              step="0.1"
              value={renderSettings.particleSize}
              onChange={(e) => updateSetting('particleSize', Number.parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          
          <div>
            <label 
              htmlFor="particle-transparency"
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Transparency: {(renderSettings.particleTransparency * 100).toFixed(0)}%
            </label>
            <input
              id="particle-transparency"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={renderSettings.particleTransparency}
              onChange={(e) => updateSetting('particleTransparency', Number.parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Bond Display */}
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Bonds
        </h4>
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={renderSettings.showBonds}
              onChange={(e) => updateSetting('showBonds', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className={`ml-2 text-sm ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Show bonds
            </span>
          </label>
          
          {renderSettings.showBonds && (
            <>
              <div>
                <label 
                  htmlFor="bond-width"
                  className={`block text-sm mb-1 ${
                    isDark ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  Width: {renderSettings.bondWidth.toFixed(1)}
                </label>
                <input
                  id="bond-width"
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.1"
                  value={renderSettings.bondWidth}
                  onChange={(e) => updateSetting('bondWidth', Number.parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              
              <div>
                <label 
                  htmlFor="bond-transparency"
                  className={`block text-sm mb-1 ${
                    isDark ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  Transparency: {(renderSettings.bondTransparency * 100).toFixed(0)}%
                </label>
                <input
                  id="bond-transparency"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={renderSettings.bondTransparency}
                  onChange={(e) => updateSetting('bondTransparency', Number.parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Lighting */}
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Lighting
        </h4>
        <div className="space-y-3">
          <div>
            <label 
              htmlFor="ambient-light"
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Ambient: {(renderSettings.ambientLight * 100).toFixed(0)}%
            </label>
            <input
              id="ambient-light"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={renderSettings.ambientLight}
              onChange={(e) => updateSetting('ambientLight', Number.parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          
          <div>
            <label 
              htmlFor="diffuse-light"
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Diffuse: {(renderSettings.diffuseLight * 100).toFixed(0)}%
            </label>
            <input
              id="diffuse-light"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={renderSettings.diffuseLight}
              onChange={(e) => updateSetting('diffuseLight', Number.parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          
          <div>
            <label 
              htmlFor="specular-light"
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Specular: {(renderSettings.specularLight * 100).toFixed(0)}%
            </label>
            <input
              id="specular-light"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={renderSettings.specularLight}
              onChange={(e) => updateSetting('specularLight', Number.parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
          
          <div>
            <label 
              htmlFor="shininess"
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Shininess: {renderSettings.shininess}
            </label>
            <input
              id="shininess"
              type="range"
              min="1"
              max="100"
              step="1"
              value={renderSettings.shininess}
              onChange={(e) => updateSetting('shininess', Number.parseInt(e.target.value, 10))}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Camera */}
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Camera
        </h4>
        <div className="space-y-3">
          <div>
            <label 
              htmlFor="camera-type"
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Projection
            </label>
            <select
              id="camera-type"
              value={renderSettings.cameraType}
              onChange={(e) => updateSetting('cameraType', e.target.value)}
              className={`w-full px-3 py-2 text-sm border rounded-md ${
                isDark 
                  ? 'bg-gray-700 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            >
              <option value="perspective">Perspective</option>
              <option value="orthographic">Orthographic</option>
            </select>
          </div>
          
          {renderSettings.cameraType === 'perspective' && (
            <div>
              <label 
                htmlFor="field-of-view"
                className={`block text-sm mb-1 ${
                  isDark ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                Field of View: {renderSettings.fieldOfView}°
              </label>
              <input
                id="field-of-view"
                type="range"
                min="10"
                max="120"
                step="1"
                value={renderSettings.fieldOfView}
                onChange={(e) => updateSetting('fieldOfView', Number.parseInt(e.target.value, 10))}
                className="w-full"
              />
            </div>
          )}
        </div>
      </div>

      {/* Rendering Quality */}
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Quality
        </h4>
        <div className="space-y-2">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={renderSettings.antialiasing}
              onChange={(e) => updateSetting('antialiasing', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className={`ml-2 text-sm ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Anti-aliasing
            </span>
          </label>
          
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={renderSettings.shadows}
              onChange={(e) => updateSetting('shadows', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className={`ml-2 text-sm ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Shadows
            </span>
          </label>
          
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={renderSettings.reflections}
              onChange={(e) => updateSetting('reflections', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className={`ml-2 text-sm ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Reflections
            </span>
          </label>
        </div>
      </div>

      {/* Output Settings */}
      <div>
        <h4 className={`text-sm font-medium mb-3 ${
          isDark ? 'text-white' : 'text-gray-900'
        }`}>
          Output
        </h4>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label 
                htmlFor="image-width"
                className={`block text-sm mb-1 ${
                  isDark ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                Width
              </label>
              <input
                id="image-width"
                type="number"
                value={renderSettings.imageWidth}
                onChange={(e) => updateSetting('imageWidth', Number.parseInt(e.target.value, 10))}
                className={`w-full px-3 py-2 text-sm border rounded-md ${
                  isDark 
                    ? 'bg-gray-700 border-gray-600 text-white' 
                    : 'bg-white border-gray-300 text-gray-900'
                }`}
              />
            </div>
            <div>
              <label 
                htmlFor="image-height"
                className={`block text-sm mb-1 ${
                  isDark ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                Height
              </label>
              <input
                id="image-height"
                type="number"
                value={renderSettings.imageHeight}
                onChange={(e) => updateSetting('imageHeight', Number.parseInt(e.target.value, 10))}
                className={`w-full px-3 py-2 text-sm border rounded-md ${
                  isDark 
                    ? 'bg-gray-700 border-gray-600 text-white' 
                    : 'bg-white border-gray-300 text-gray-900'
                }`}
              />
            </div>
          </div>
          
          <div>
            <label 
              htmlFor="image-format"
              className={`block text-sm mb-1 ${
                isDark ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Format
            </label>
            <select
              id="image-format"
              value={renderSettings.imageFormat}
              onChange={(e) => updateSetting('imageFormat', e.target.value)}
              className={`w-full px-3 py-2 text-sm border rounded-md ${
                isDark 
                  ? 'bg-gray-700 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            >
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
              <option value="tiff">TIFF</option>
              <option value="bmp">BMP</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
