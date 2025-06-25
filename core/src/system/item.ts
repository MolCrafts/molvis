import { Vector3 } from "@babylonjs/core";
import type { IProp } from "./base";
import { Entity } from "./base";

export class Atom extends Entity<IProp> {
  constructor(props: Record<string, IProp> = {}) {
    super(props);
    
    // Store each property as individual components in ECS system
    // Currently we only use internal dictionary
    // ECS storage can be implemented when needed for queries
  }

  get name(): string {
    return this.get("name") as string;
  }

  get xyz(): Vector3 {
    return new Vector3(
      this.get("x") as number || 0,
      this.get("y") as number || 0,
      this.get("z") as number || 0,
    );
  }

  /**
   * Update a property using immutable approach
   */
  updateProperty(key: string, value: IProp): Atom {
    return this.with(key, value) as Atom;
  }
}

export class Bond extends Entity<IProp> {
  private _itom: Atom;
  private _jtom: Atom;

  constructor(itom: Atom, jtom: Atom, props: Record<string, IProp> = {}) {
    super(props);
    this._itom = itom;
    this._jtom = jtom;
    
    // Only store props in ECS, not itom and jtom references
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

  get order(): number {
    return (this.get("order") as number) ?? 1;
  }

  /**
   * Update a property using immutable approach
   */
  updateProperty(key: string, value: IProp): Bond {
    const updatedProps = { ...this.toJSON(), [key]: value };
    return new Bond(this._itom, this._jtom, updatedProps);
  }
}
