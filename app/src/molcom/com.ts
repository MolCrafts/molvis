import MolvisApp from "../molvis/app";
import { Server } from "socket.io";
import { createServer } from "http";

class Com {

    private molvis: MolvisApp;
    private io: Server;

    constructor(molvis: MolvisApp, websocket_addr: string) {
        this.molvis = molvis;
        const httpServer = createServer();
        this.io = new Server(httpServer, {})
        this.io.on("connection", (socket) => {
            console.log(socket);
        });
        httpServer.listen(8080);
    }

    public send_message(message: string) {
        this.io.emit("message", message);
    }

}

export { Com };
