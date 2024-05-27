import { Molvis, JsonRPCRequest, IJsonPRCRequest} from 'core';
import { useEffect, useRef } from 'react';

const MolvisCore = ({ canvas, json_rpc_request=null }: {canvas: HTMLCanvasElement,json_rpc_request: IJsonPRCRequest|null }) => {

    const molvisRef = useRef<Molvis | null>(null);
    const requestRef = useRef<IJsonPRCRequest | null>(json_rpc_request);
    
    useEffect(() => {
        if (!canvas) {
            throw Error('Canvas element not found but ' + canvas);
        }

        if (!molvisRef.current) {
            molvisRef.current = new Molvis(canvas);
            const molvis = molvisRef.current;

            molvis.render();
    
            // molvis.response_json(JsonRPCRequest(
            //     "system.box.set_orthogonal_box",
            //     {
            //         lengths: [5, 5, 5],
            //         origin: [0, 0, 0],
            //         direction: [0, 0, 0]
            //     }
            // ));
    
            // molvis.response_json(JsonRPCRequest(
            //     "system.box.draw",
            //     {}
            // ));
    
            // molvis.response_json(JsonRPCRequest(
            //     "system.frame.add_atom",
            //     {
            //         name: "C",
            //         x: 0,
            //         y: 0,
            //         z: 0
            //     }
            // ));
    
            molvis.system.frame.add_atom("C", 0, 0, 0);
            molvis.response_json(JsonRPCRequest(
                "system.draw",
                {}
            ))
            // molvis.system.frame.draw();
    
        }

        return () => {
        };
    }, [canvas]);

    useEffect(() => {
        if (molvisRef.current && requestRef.current) {
            molvisRef.current.response_json(requestRef.current!);
        }
    }, [requestRef.current]);

    return null;
};

export default MolvisCore;