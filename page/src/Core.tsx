import { Molvis, JsonRPCRequest, IJsonPRCRequest} from 'core';
import { useEffect, useRef } from 'react';

const MolvisCore = ({ canvas, json_rpc_request=null }: {canvas: HTMLCanvasElement,json_rpc_request: IJsonPRCRequest|null }) => {

    const molvisRef = useRef<Molvis | null>(null);
    
    useEffect(() => {
        if (!canvas) {
            throw Error('Canvas element not found but ' + canvas);
        }

        if (!molvisRef.current) {
            molvisRef.current = new Molvis(canvas);
            const molvis = molvisRef.current;

            molvis.start();
            
            const controller = molvis.get_controller();
            controller.add_atom('C', {x: 0, y: 0, z: 0});
            controller.add_atom('H', {x: 1, y: 0, z: 0});
            controller.add_atom('O', {x: 0, y: 1, z: 0});
            controller.add_atom('N', {x: 0, y: 0, z: 1});
    
        }

        return () => {
        };
    }, [canvas]);

    return null;
};

export default MolvisCore;