import * as React from "react";
import { createRender, useModelState } from "@anywidget/react";
import "./widget.css";
import MolvisCore from "page/src/Core";

const render = createRender(() => {

    const canvas_ref = React.useRef<HTMLCanvasElement>(null);
    const [canvas, setCanvas] = React.useState<HTMLCanvasElement | null>(null);

    React.useEffect(() => {
        if (canvas_ref.current) {
            setCanvas(canvas_ref.current);
        }
    }, [canvas_ref.current]);

    return (
        <div id="molvis-display">
            <canvas id="molvis-canvas" ref={canvas_ref}></canvas>
            {canvas && <MolvisCore canvas={canvas} />}
        </div>
    )
});

export default { render };
