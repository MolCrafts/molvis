import * as React from "react";
import { createRender, useModelState } from "@anywidget/react";
import "./widget.css";
import MolvisCore from "page/src/Core";
import { IJsonPRCRequest } from "core";

const render = createRender(() => {

    const canvas_ref = React.useRef<HTMLCanvasElement>(null);
    const [canvas, setCanvas] = React.useState<HTMLCanvasElement | null>(null);

    let [request, set_request] = useModelState<object>("request_");

    React.useEffect(() => {
        if (canvas_ref.current) {
            setCanvas(canvas_ref.current);
        }
    }, [canvas_ref.current]);

    return (
        <div id="molvis-display">
            <canvas id="molvis-canvas" ref={canvas_ref}></canvas>
            {canvas && <MolvisCore canvas={canvas} json_rpc_request={request as IJsonPRCRequest}/>}
        </div>
    )
});

export default { render };
