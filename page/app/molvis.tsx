"use client"

import { initMolvisApp, InitMolvisAppOptions } from "molvis";
import React, { useRef, useEffect } from 'react';

export default function Molvis() {

    const canvasRef = useRef(null);

    useEffect( () => {

        const initMolvis = () => {
            let assetsHostUrl;
            // if (DEV_BUILD) {
            //     assetsHostUrl = "http://127.0.0.1:8181/";
            // } else {
            //     assetsHostUrl = "https://nonlocal-assets-host-url/";
            // }
            assetsHostUrl = "http://127.0.0.1:8181/"

            const options: InitMolvisAppOptions = {
                canvas: canvasRef.current, assetsHostUrl: assetsHostUrl
            }

            return initMolvisApp(options);
        }
        const app = initMolvis();
        app.system.box.set_lengths_and_angles([5, 5, 5], [90, 90, 90]);
        let atom1 = app.system.atoms.add_atom({"xyz": [0, 0, 0]});
        let atom2 = app.system.atoms.add_atom({"xyz": [2, 2, 2]});
        let atom3 = app.system.atoms.add_atom({"xyz": [2, 2, 0]});
        let atom4 = app.system.atoms.add_atom({"xyz": [2, 0, 0]});
        app.system.bonds.add_bond(atom1, atom2, {})
        app.system.bonds.add_bond(atom1, atom3, {})
        app.system.bonds.add_bond(atom1, atom4, {})
        app.run();

    }, []);

    return (
        <canvas id="molvisCanvas" ref={canvasRef}></canvas>
    );

}