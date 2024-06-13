import { Molvis } from 'core';
import { useEffect, useRef, createContext, useContext } from 'react';

const molvisContext = createContext(new Molvis());

const MolvisCore = () => {

    const canvasRef = useRef(null);
    const molvis = useContext(molvisContext);

    useEffect(() => {
        if (canvasRef.current) {
            molvis.init(canvasRef.current);
            molvis.start();
        }
    }, [canvasRef]);


    return (
        <>
            <canvas id="molvis-canvas" ref={canvasRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0, display: "block" }}></canvas>
        </>
    );
}

export { MolvisCore, molvisContext };