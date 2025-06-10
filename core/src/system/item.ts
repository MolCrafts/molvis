import { Vector3 } from "@babylonjs/core";
import type { IProp } from "./base";
import { Entity } from "./base";

export class Atom extends Entity<IProp> {
  constructor(
    name: string,
    x: number,
    y: number,
    z: number,
    props: Record<string, IProp> = {},
  ) {
    super({
      name,
      x,
      y,
      z,
      ...props,
    });
  }

  get name(): string {
    return this.get("name") as string;
  }

  get xyz() {
    return new Vector3(
      this.get("x") as number,
      this.get("y") as number,
      this.get("z") as number,
    );
  }
}

export class Bond extends Entity<IProp> {
  private _itom: Atom;
  private _jtom: Atom;

  constructor(itom: Atom, jtom: Atom, props: Record<string, IProp> = {}) {
    super(props);
    this._itom = itom;
    this._jtom = jtom;
  }

  get itom(): Atom {
    return this._itom;
  }

  get jtom(): Atom {
    return this._jtom;
  }

  get name(): string {
    return (
      (this.get("name") as string) ?? `${this._itom.name}-${this._jtom.name}`
    );
  }
}
