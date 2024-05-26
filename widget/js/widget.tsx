import * as React from "react";
import { createRender, useModelState } from "@anywidget/react";
import "./widget.css";
import MolvisCore from "page/src/Core";

const render = createRender(() => {

    const canvas_ref = React.useRef<HTMLCanvasElement>(null);
    const [canvas, setCanvas] = React.useState<HTMLCanvasElement | null>(null);

    let [target, set_target] = useModelState<string>("target");
    let [method, set_method] = useModelState<string>("method");
    let [kwargs, set_kwargs] = useModelState<object>("kwargs");

    React.useEffect(() => {
        if (canvas_ref.current) {
            setCanvas(canvas_ref.current);
        }
    }, [canvas_ref.current]);

    return (
        <div id="molvis-display">
            <canvas id="molvis-canvas" ref={canvas_ref}></canvas>
            {canvas && <MolvisCore canvas={canvas} target={target} method={method} kwargs={kwargs}/>}
        </div>
    )
});

export default { render };
