import { createRoot } from "react-dom/client";
import { Molvis } from "molvis";

document.body.innerHTML = "<div id='root'></div>";
const root = createRoot(document.getElementById("root")!);
root.render(<Molvis />);