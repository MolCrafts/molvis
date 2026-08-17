import { SketchCommand } from "../sketch_command";

/** Run several commands as one history entry (undo reverses in reverse order). */
export class CompositeCommand extends SketchCommand {
  constructor(private readonly commands: SketchCommand[]) {
    super();
  }

  do(): void {
    for (const c of this.commands) c.do();
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}
