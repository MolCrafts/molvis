import { useRef, useState, useEffect, createContext, useContext } from 'react';
import { Molvis } from '@molvis/core';


// Molvis Core Context Definition
interface MolvisCoreContextValue {
  core: Molvis | null;
  mountPoint: HTMLDivElement | null;
}

const MolvisCoreContext = createContext<MolvisCoreContextValue>({
  core: null,
  mountPoint: null,
});

// Hook to access Molvis Core from components
export const useMolvisCore = () => useContext(MolvisCoreContext);

// Provider component for Molvis Core
export const MolvisCoreProvider = ({ children }: { children: React.ReactNode }): JSX.Element => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [core, setCore] = useState<Molvis | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      // Create an empty molvis instance (using mock for now)
      const app = new Molvis(canvasRef.current, {
        fitContainer: true,
        showUI: false,
        debug: false,
      });
      app.start();
      setCore(app);
      
      // Cleanup function
      return () => app.destroy();
    }
  }, []);

  return (
    <MolvisCoreContext.Provider value={{ core, mountPoint: canvasRef.current }}>
      <div className="flex-1 flex flex-col relative">
        <div
          ref={canvasRef}
          style={{ width: '100%', height: '100%' }}
          className="molvis-mount-point"
        />
        {children}
      </div>
    </MolvisCoreContext.Provider>
  );
};
