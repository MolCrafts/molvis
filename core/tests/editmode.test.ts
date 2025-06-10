import { jest } from '@jest/globals';
import { System } from '../src/system';
import { EditMode } from '../src/mode/edit';
import type { Molvis } from '../src/app';

jest.mock('../src/artist', () => ({
  draw_atom: jest.fn(),
  draw_bond: jest.fn(),
}));

jest.mock('../src/mode/utils', () => ({
  get_vec3_from_screen_with_depth: () => ({ x: 1, y: 0, z: 0 }),
}));

jest.mock('@babylonjs/core', () => {
  class Vector3 {
    constructor(public x:number, public y:number, public z:number) {}
    add(v: any) { return new Vector3(this.x+v.x, this.y+v.y, this.z+v.z); }
    scale(s: number){ return new Vector3(this.x*s, this.y*s, this.z*s); }
    subtract(v: any){ return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z); }
    length(){ return Math.sqrt(this.x*this.x + this.y*this.y + this.z*this.z); }
    copyFrom(v: any){ this.x=v.x; this.y=v.y; this.z=v.z; }
  }
  class Vector2 {
    constructor(public x = 0, public y = 0) {}
    subtract(v: any) { return new Vector2(this.x - v.x, this.y - v.y); }
    length() { return Math.sqrt(this.x*this.x + this.y*this.y); }
  }
  return {
    Vector3,
    Vector2,
    MeshBuilder: { CreateSphere: jest.fn(() => ({ dispose: jest.fn(), position: new Vector3(0,0,0) })), CreateTube: jest.fn(() => ({ dispose: jest.fn() })) },
    StandardMaterial: class { constructor(public name:string){ this.diffuseColor=null; } },
    Color3: class { constructor(public r:number, public g:number, public b:number){} static FromHexString(){ return new Color3(0,0,0); } },
  };
});

function createScene() {
  return {
    pointerX:0,
    pointerY:0,
    meshes: [] as any[],
    onPointerObservable:{add: jest.fn(), remove: jest.fn()},
    onKeyboardObservable:{add: jest.fn(), remove: jest.fn()},
    pick: jest.fn(() => ({ hit: false })),
    getEngine: jest.fn(() => ({ getRenderingCanvas: jest.fn(()=>'canvas') })),
  };
}

describe('EditMode', () => {
  test('add atom on click', () => {
    const system = new System();
    const scene = createScene();
    const camera = { detachControl: jest.fn(), attachControl: jest.fn() };
    const app = { world: { scene, camera }, system, gui: {} } as unknown as Molvis;

    const mode = new EditMode(app);
    mode._on_pointer_down({ event: { button: 0, clientX: 0, clientY: 0 } } as any);
    expect(system.current_frame.atoms.length).toBe(1);
    mode.finish();
  });

  test('drag from atom creates bonded atom', () => {
    const system = new System();
    const scene = createScene();
    const camera = { detachControl: jest.fn(), attachControl: jest.fn() };
    const app = { world: { scene, camera }, system, gui: {} } as unknown as Molvis;

    const start = system.current_frame.add_atom('a1',0,0,0,{type:'C'});
    scene.meshes.push({ name: 'atom:a1', dispose: jest.fn() });
    scene.pick.mockReturnValueOnce({ hit: true, pickedMesh: { name: 'atom:a1' } });

    const mode = new EditMode(app);
    mode._on_pointer_down({ event: { button:0, clientX:0, clientY:0 } } as any);
    mode._on_pointer_move({ event: { buttons:1, clientX:1, clientY:1 } } as any);
    scene.pointerX = 1; scene.pointerY = 1;
    mode._on_pointer_up({ event: { button:0, clientX:1, clientY:1 } } as any);

    expect(camera.detachControl).toHaveBeenCalled();
    expect(camera.attachControl).toHaveBeenCalled();
    expect(system.current_frame.atoms.length).toBe(2);
    expect(system.current_frame.bonds.length).toBe(1);
    mode.finish();
  });

  test('drag from atom onto existing atom only bonds', () => {
    const system = new System();
    const scene = createScene();
    const camera = { detachControl: jest.fn(), attachControl: jest.fn() };
    const app = { world: { scene, camera }, system, gui: {} } as unknown as Molvis;

    const a1 = system.current_frame.add_atom('a1',0,0,0,{type:'C'});
    const a2 = system.current_frame.add_atom('a2',1,0,0,{type:'C'});
    scene.meshes.push({ name: 'atom:a1', dispose: jest.fn() });
    scene.meshes.push({ name: 'atom:a2', dispose: jest.fn() });

    scene.pick.mockReturnValueOnce({ hit: true, pickedMesh: { name: 'atom:a1' } });
    scene.pick.mockReturnValueOnce({ hit: true, pickedMesh: { name: 'atom:a2' } });

    const mode = new EditMode(app);
    mode._on_pointer_down({ event: { button:0, clientX:0, clientY:0 } } as any);
    mode._on_pointer_move({ event: { buttons:1, clientX:5, clientY:5 } } as any);
    scene.pointerX = 5; scene.pointerY = 5;
    mode._on_pointer_up({ event: { button:0, clientX:5, clientY:5 } } as any);

    expect(system.current_frame.atoms.length).toBe(2);
    expect(system.current_frame.bonds.length).toBe(1);
    mode.finish();
  });

  test('right click deletes atom', () => {
    const system = new System();
    const scene = createScene();
    const camera = { detachControl: jest.fn(), attachControl: jest.fn() };
    const app = { world: { scene, camera }, system, gui: {} } as unknown as Molvis;

    const a = system.current_frame.add_atom('a1',0,0,0,{});
    scene.meshes.push({ name: 'atom:a1', dispose: jest.fn() });
    scene.pick.mockReturnValue({ hit: true, pickedMesh: { name: 'atom:a1' } });

    const mode = new EditMode(app);
    mode._on_pointer_down({ event: { button:2, clientX:0, clientY:0 } } as any);
    mode._on_pointer_up({ event: { button:2, clientX:0, clientY:0 } } as any);
    expect(system.current_frame.atoms.length).toBe(0);
    mode.finish();
  });
});
