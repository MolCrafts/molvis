import { Logger } from "tslog";
import { ModeManager } from "./mode";
import { System } from "./system";
import { World } from "./world";
import { Executor } from "./command";
import { GuiManager } from "./gui";
// import { ArtistGuild } from "./artist";

const logger = new Logger({ name: "molvis-core" });

class Molvis {

  private _world: World;
  private _system: System;
  private _mode: ModeManager;
  private _executor: Executor;
  private _gui: GuiManager;
  // private _artist: ArtistGuild;

  constructor(canvas: HTMLCanvasElement) {
    this._system = new System();
    this._world = new World(canvas);
    this._gui = new GuiManager(this);
    this._mode = new ModeManager(this);
    // this._artist = new ArtistGuild(this);
    this._executor = new Executor(this);
    logger.info("Molvis initialized");
  }

  get world(): World {
    return this._world;
  }

  get system(): System {
    return this._system;
  }

  get scene() {
    return this._world.scene;
  }

  // get artist(): ArtistGuild {
  //   return this._artist;
  // }

  get mode(): ModeManager {
    return this._mode;
  }

  get executor(): Executor {
    return this._executor;
  }

  get gui(): GuiManager {
    return this._gui;
  }

  public execute(cmd: string, args: {}) {
    const [meshes, entities] = this._executor.execute(cmd, args);
    this._world.pipeline.modify(
      this,
      meshes,
      entities
    )
  }

  public modify(name: string, args: {}) {
    this._world.append_modifier(name, args);
  }

  public render = () => {
    this._world.render();
  };

  public stop = () => {
    this._world.stop();
  };

  public resize = () => {
    this._world.resize();
  };

  public finalize = () => { };

  get isRunning() {
    return this._world.isRunning;
  }

}

export { Molvis };
