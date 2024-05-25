import {Molvis} from 'core';
import { useEffect } from 'react';

const MolvisCore = ({ canvas }: {canvas: HTMLCanvasElement}) => {

    useEffect(() => {

        if (!canvas) throw new Error('Canvas element not found but '+ canvas);
        
        const molvis = new Molvis(canvas);
        molvis.set_orthogonal_box([10, 10, 10], [0, 0, 0], [1, 0, 0]);

        molvis.render();

    }, [canvas]);

    return null;
};

export default MolvisCore;