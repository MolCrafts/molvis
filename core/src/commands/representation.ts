import type { MolvisApp } from "../app";
import type { RepresentationStyle } from "../artist/representation";
import { Command, command } from "./base";

@command("set_representation")
export class SetRepresentationCommand extends Command<void> {
  private next: RepresentationStyle;
  private prev: RepresentationStyle;

  constructor(app: MolvisApp, args: { style: RepresentationStyle }) {
    super(app);
    this.next = args.style;
    this.prev = app.styleManager.getRepresentation();
  }

  async do(): Promise<void> {
    await this.applyRepresentation(this.next);
  }

  async undo(): Promise<Command> {
    await this.applyRepresentation(this.prev);
    return new SetRepresentationCommand(this.app, { style: this.prev });
  }

  private async applyRepresentation(repr: RepresentationStyle): Promise<void> {
    this.app.styleManager.setRepresentation(repr);

    // Representation changes affect every geometry-producing draw modifier.
    // Re-run the whole pipeline so auxiliary layers such as isosurfaces and
    // ribbons survive the atom/bond rebuild with their current settings.
    if (this.app.system.frame) {
      await this.app.applyPipeline({ fullRebuild: true });
    } else {
      this.app.artist.redrawFromSceneIndex();
    }

    this.app.events.emit("representation-change", repr);
  }
}
