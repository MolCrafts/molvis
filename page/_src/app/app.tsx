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

            const app = initMolvisApp(options);
            app.run();
        }
        initMolvis();
    }, []);

    return (
        <div><canvas ref={canvasRef}></canvas></div>
    );

}