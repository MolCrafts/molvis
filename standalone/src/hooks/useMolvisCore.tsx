import { useRef, useState, useEffect, createContext, useContext } from "react";
import { Molvis } from "@molvis/core";
import { Logger } from "tslog";

// Create logger instance
const logger = new Logger({
  name: "MolvisCore",
  minLevel: 0, // 0 = SILLY, 1 = TRACE, 2 = DEBUG, 3 = INFO, 4 = WARN, 5 = ERROR, 6 = FATAL
});

// Molvis Core Context Definition
interface MolvisCoreContextValue {
  core: Molvis | null;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  isReady: boolean;
}

const MolvisCoreContext = createContext<MolvisCoreContextValue | null>(null);

export const useMolvisCore = () => {
  const context = useContext(MolvisCoreContext);
  if (!context) {
    logger.error("useMolvisCore must be used within a MolvisCoreProvider");
    throw new Error("useMolvisCore must be used within a MolvisCoreProvider");
  }
  return context;
};

// Provider component for Molvis Core - using React 19 syntax
export const MolvisCoreProvider = ({
  children,
}: { children: React.ReactNode }): React.ReactElement => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [core, setCore] = useState<Molvis | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const initializeCore = async () => {
      if (canvasRef.current && !core && isMounted) {
        logger.info("Creating Molvis core instance...");
        try {
          // Create an empty molvis instance
          const newCore = new Molvis(canvasRef.current, {
            fitContainer: true,
            showUI: false,
            debug: false,
          });
          
          if (isMounted) {
            newCore.start();
            setCore(newCore);
            setIsReady(true);
            logger.info("Molvis core created successfully", {
              mountPoint: canvasRef.current.className,
              config: { fitContainer: true, showUI: false, debug: false },
            });
          }
        } catch (error) {
          if (isMounted) {
            logger.error("Failed to create Molvis core instance", error);
            setCore(null);
            setIsReady(false);
          }
        }
      }
    };

    // Initialize core when canvas ref is available
    if (canvasRef.current) {
      initializeCore();
    }

    return () => {
      isMounted = false;
      if (core) {
        logger.info("Destroying Molvis core instance");
        core.destroy();
        setCore(null);
        setIsReady(false);
        logger.debug("Molvis core destroyed");
      }
    };
  }, [core]);

  const contextValue: MolvisCoreContextValue = {
    core,
    canvasRef,
    isReady,
  };

  return (
    <MolvisCoreContext value={contextValue}>
      {children}
    </MolvisCoreContext>
  );
};

// Canvas component that renders the Molvis mount point
export const MolvisCanvas = (): React.ReactElement => {
  const { canvasRef, isReady } = useMolvisCore();

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div
        ref={canvasRef}
        style={{ 
          width: "100%", 
          height: "100%",
          backgroundColor: isReady ? "transparent" : "#f8f9fa",
          pointerEvents: "auto", // 确保可以接收鼠标事件
          position: "relative",
          zIndex: 1, // 确保在正确的层级
        }}
        className="molvis-mount-point"
        role="button"
        tabIndex={0}
        onMouseDown={(e) => {
          // 添加调试信息
          logger.debug("Canvas mouse down", { 
            target: e.target, 
            currentTarget: e.currentTarget,
            isReady,
            core: !!canvasRef.current
          });
        }}
        onClick={(e) => {
          // 添加调试信息
          logger.debug("Canvas clicked", { 
            x: e.clientX, 
            y: e.clientY, 
            isReady,
            hasCore: !!canvasRef.current
          });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            logger.debug("Canvas key pressed", { key: e.key });
          }
        }}
      />
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-gray-500 text-sm">
            Initializing Molvis...
          </div>
        </div>
      )}
    </div>
  );
};
