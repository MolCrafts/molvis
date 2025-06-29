import {
  TransformNode,
  AbstractMesh,
} from "@babylonjs/core";

export class MeshGroup extends TransformNode {

  /**
   * Create or get a named subgroup, returned as a MeshGroup.
   */
  public createSubgroup(name: string): MeshGroup {
    const existing = this.getSubgroup(name);
    if (existing) {
      return existing;
    }
    const subgroup = new MeshGroup(name, this.getScene());
    subgroup.parent = this;
    return subgroup;
  }

  /**
   * Remove (and dispose) a named subgroup.
   */
  public deleteSubgroup(name: string): boolean {
    const subgroup = this.getSubgroup(name);
    if (!subgroup) {
      return false;
    }
    // Detach meshes if you prefer
    for (const child of subgroup.getChildren()) {
      if (child instanceof AbstractMesh) {
        child.parent = null;
      }
    }
    subgroup.dispose();
    return true;
  }

  /**
   * Lookup returns a MeshGroup if it exists.
   */
  public getSubgroup(name: string): MeshGroup | undefined {
    const node = this.getChildren().find(c => c.name === name);
    return node instanceof MeshGroup ? node : undefined;
  }

  /**
   * Add a mesh into this group or into a named subgroup.
   */
  public addMesh(mesh: AbstractMesh, subgroupName?: string): void {
    if (subgroupName) {
      const sub = this.createSubgroup(subgroupName);
      mesh.parent = sub;
    } else {
      mesh.parent = this;
    }
  }

    /**
     * Add multiple meshes into this group or into a named subgroup.
     */
    public addMeshs(meshes: AbstractMesh[], subgroupName?: string): void {
    
        const sub = subgroupName ? this.createSubgroup(subgroupName) : this;
        for (const mesh of meshes) {
            mesh.parent = sub;
        }
        
    }

  /**
   * Remove a mesh from this group (detaches it).
   */
  public removeMesh(mesh: AbstractMesh): boolean {
    const parent = mesh.parent;
    if (parent === this || (parent instanceof MeshGroup && parent.parent === this)) {
      mesh.parent = null;
      return true;
    }
    return false;
  }
}
