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

            molvis.render();

            molvis.system.frame.add_atom('C', 0, 0, 0);
            molvis.system.frame.add_atom('H', 1, 0, 0);
            molvis.system.frame.add_atom('H', 0, 1, 0);
            molvis.system.frame.add_atom('H', 0, 0, 1);
            molvis.system.frame.draw_all_atoms();
    
        }

        return () => {
        };
    }, [canvas]);

    if (molvisRef.current && json_rpc_request) {
        molvisRef.current.response_json(json_rpc_request!);
    }

    return null;
};

export default MolvisCore;