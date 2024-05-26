import Molvis from 'core';
import { useEffect, useRef } from 'react';

const MolvisCore = ({ canvas, target="", method="", kwargs={} }: {canvas: HTMLCanvasElement, target: string, method:string, kwargs: object}) => {

    const molvisRef = useRef<Molvis | null>(null);
    
    useEffect(() => {
        if (!canvas) {
            throw new Error('Canvas element not found but ' + canvas);
        }

        if (!molvisRef.current) {
            molvisRef.current = new Molvis(canvas);
        }

        const molvis = molvisRef.current;

        molvis.render();
        console.log('re-rendered');
        return () => {
        };
    }, [canvas]);

    useEffect(() => {
        if (molvisRef.current && target) {
            molvisRef.current.do(target, method, kwargs);
        }
    }, [target, method, kwargs]);

    return null;
};

export default MolvisCore;