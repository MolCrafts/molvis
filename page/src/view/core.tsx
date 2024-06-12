import { Molvis } from 'core';
import { useEffect, useRef, createContext, useContext } from 'react';
import './core.css';

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
            <canvas id="molvis-canvas" ref={canvasRef} ></canvas>
        </>
    );
}

export { MolvisCore, molvisContext };