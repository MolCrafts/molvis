import { Molvis, JsonRPCRequest, IJsonPRCRequest } from 'core';
import { useEffect, useRef } from 'react';

const MolvisCore = ({ canvas, json_rpc_request = null }: { canvas: HTMLCanvasElement, json_rpc_request: IJsonPRCRequest | null }) => {

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
            controller.use_trajectory();

            // get rotate matrix
            const get_rotate_matrix = (axis: string, angle: number) => {
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const rotate_matrix: { [key: string]: number[][] } = {
                    x: [[1, 0, 0], [0, cos, -sin], [0, sin, cos]],
                    y: [[cos, 0, sin], [0, 1, 0], [-sin, 0, cos]],
                    z: [[cos, -sin, 0], [sin, cos, 0], [0, 0, 1]]
                };
                return rotate_matrix[axis];
            }

            const rotate = (xyz: number[][], R: number[][]) => {
                const result = [];
                for (let i = 0; i < xyz.length; i++) {
                    const x = xyz[i][0];
                    const y = xyz[i][1];
                    const z = xyz[i][2];
                    const x1 = R[0][0] * x + R[0][1] * y + R[0][2] * z;
                    const y1 = R[1][0] * x + R[1][1] * y + R[1][2] * z;
                    const z1 = R[2][0] * x + R[2][1] * y + R[2][2] * z;
                    result.push([x1, y1, z1]);
                }
                return result;
            }

            const init_xyz = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];

            for (let i = 0; i < 10; i++) {
                const frame = controller.new_frame()
                const R = get_rotate_matrix('z', i * Math.PI / 5);
                const xyz = rotate(init_xyz, R);
                frame.add_atom('C', xyz[0][0], xyz[0][1], xyz[0][2], { type: "C" });
                frame.add_atom('H', xyz[1][0], xyz[1][1], xyz[1][2], { type: "H" });
                frame.add_atom('O', xyz[2][0], xyz[2][1], xyz[2][2], { type: "O" });
                frame.add_atom('N', xyz[3][0], xyz[3][1], xyz[3][2], { type: "N" });
                frame.add_bond('0-1', 0, 1, {});
                frame.add_bond('0-2', 0, 2, {});
                frame.add_bond('0-3', 0, 3, {});
                controller.add_frame(frame);
            }
            controller.play();
        }

        return () => {
        };
    }, [canvas]);

    return null;
};

export default MolvisCore;