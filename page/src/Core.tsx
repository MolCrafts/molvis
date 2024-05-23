import {Molvis} from 'core';
import { useEffect } from 'react';

const MolvisCore = ({ canvas }: {canvas: HTMLCanvasElement}) => {

    useEffect(() => {

        if (!canvas) throw new Error('Canvas element not found but '+ canvas);
        
        const molvis = new Molvis(canvas);

        molvis.run();

    }, [canvas]);

    return null;
};

export default MolvisCore;