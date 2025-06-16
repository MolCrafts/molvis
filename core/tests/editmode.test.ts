import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { System } from '../src/system';
import { EditMode } from '../src/mode/edit';
import type { Molvis } from '../src/app';
import { 
  Scene, 
  type Engine, 
  NullEngine, 
  Vector3, 
  UniversalCamera,
  MeshBuilder,
  type StandardMaterial,
  type Color3,
  type PointerInfo,
  PointerEventTypes
} from '@babylonjs/core';

// Setup DOM environment for Tweakpane
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  resources: 'usable'
});

// @ts-ignore
global.window = dom.window;
// @ts-ignore 
global.document = dom.window.document;
// @ts-ignore
global.HTMLElement = dom.window.HTMLElement;
// @ts-ignore
global.HTMLDivElement = dom.window.HTMLDivElement;

// Mock draw functions that require complex rendering
jest.mock('../src/artist', () => ({
  draw_atom: jest.fn(),
  draw_bond: jest.fn(),
}));

// Mock the utils function that requires screen space calculations
jest.mock('../src/mode/utils', () => ({
  get_vec3_from_screen_with_depth: () => new Vector3(1, 0, 0),
}));

function createTestApp(): Molvis {
  const system = new System();
  
  // Create a real BabylonJS scene with NullEngine (no WebGL required)
  const engine = new NullEngine({
    renderHeight: 256,
    renderWidth: 256,
    textureSize: 256,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  
  const scene = new Scene(engine);
  const camera = new UniversalCamera("camera", new Vector3(0, 0, -10), scene);
  
  const world = {
    scene,
    camera
  };
  
  const app = { 
    world, 
    system, 
    gui: {},
    get scene() { return scene; }  // Add scene getter for compatibility with draw functions
  } as unknown as Molvis;
  return app;
}

function createPointerInfo(type: number, button: number, clientX: number, clientY: number, pickInfo?: unknown, buttons?: number): PointerInfo {
  return {
    type,
    event: { 
      button, 
      clientX, 
      clientY, 
      buttons: buttons ?? (button === 0 ? 1 : 2) 
    } as PointerEvent,
    pickInfo: pickInfo || { hit: false }
  } as unknown as PointerInfo;
}

describe('EditMode', () => {
  test('creates EditMode instance with real Tweakpane', () => {
    const app = createTestApp();
    const mode = new EditMode(app);
    
    expect(mode).toBeInstanceOf(EditMode);
    expect(mode.element).toBe('C'); // default element
    expect(mode.bondOrder).toBe(1); // default bond order
    
    mode.finish();
  });

  test('can change element and bond order', () => {
    const app = createTestApp();
    const mode = new EditMode(app);
    
    mode.element = 'N';
    mode.bondOrder = 2;
    
    expect(mode.element).toBe('N');
    expect(mode.bondOrder).toBe(2);
    
    mode.finish();
  });

  test('add atom on click', () => {
    const app = createTestApp();
    const mode = new EditMode(app);
    
    const pointerInfo = createPointerInfo(PointerEventTypes.POINTERDOWN, 0, 0, 0);
    mode._on_pointer_down(pointerInfo);
    
    const upPointerInfo = createPointerInfo(PointerEventTypes.POINTERUP, 0, 0, 0);
    mode._on_pointer_up(upPointerInfo);
    
    expect(app.system.current_frame.atoms.length).toBe(1);
    mode.finish();
  });

  test('creates atom with specified element', () => {
    const app = createTestApp();
    const mode = new EditMode(app);
    mode.element = 'O';
    
    const pointerInfo = createPointerInfo(PointerEventTypes.POINTERDOWN, 0, 0, 0);
    mode._on_pointer_down(pointerInfo);
    mode._on_pointer_up(pointerInfo);
    
    expect(app.system.current_frame.atoms.length).toBe(1);
    expect(app.system.current_frame.atoms[0].get('type')).toBe('O');
    
    mode.finish();
  });

  test('drag from atom creates bonded atom', () => {
    const app = createTestApp();
    
    // Add an atom and its mesh to the scene
    const atom1 = app.system.current_frame.add_atom('a1', 0, 0, 0, { type: 'C' });
    const sphere = MeshBuilder.CreateSphere('atom:a1', { diameter: 0.5 }, app.world.scene);
    sphere.position = new Vector3(0, 0, 0);
    
    // Mock scene.pick to return our atom
    (app.world.scene.pick as jest.Mock) = jest.fn().mockReturnValue({
      hit: true,
      pickedMesh: sphere
    });
    
    const mode = new EditMode(app);
    
    // Start drag from atom
    const downInfo = createPointerInfo(PointerEventTypes.POINTERDOWN, 0, 0, 0, { hit: true, pickedMesh: sphere });
    mode._on_pointer_down(downInfo);
    
    // Move to new position
    const moveInfo = createPointerInfo(PointerEventTypes.POINTERMOVE, 0, 10, 10, undefined, 1);
    mode._on_pointer_move(moveInfo);
    
    // End drag
    const upInfo = createPointerInfo(PointerEventTypes.POINTERUP, 0, 10, 10);
    mode._on_pointer_up(upInfo);
    
    expect(app.system.current_frame.atoms.length).toBe(2);
    expect(app.system.current_frame.bonds.length).toBe(1);
    
    mode.finish();
  });

  test('drag from atom to existing atom creates bond only', () => {
    const app = createTestApp();
    
    // Add two atoms
    const atom1 = app.system.current_frame.add_atom('a1', 0, 0, 0, { type: 'C' });
    const atom2 = app.system.current_frame.add_atom('a2', 1, 0, 0, { type: 'C' });
    
    const sphere1 = MeshBuilder.CreateSphere('atom:a1', { diameter: 0.5 }, app.world.scene);
    const sphere2 = MeshBuilder.CreateSphere('atom:a2', { diameter: 0.5 }, app.world.scene);
    
    // Mock scene.pick to return different atoms at different times
    (app.world.scene.pick as jest.Mock) = jest.fn()
      .mockReturnValueOnce({ hit: true, pickedMesh: sphere1 })
      .mockReturnValueOnce({ hit: true, pickedMesh: sphere2 });
    
    const mode = new EditMode(app);
    
    const downInfo = createPointerInfo(PointerEventTypes.POINTERDOWN, 0, 0, 0, { hit: true, pickedMesh: sphere1 });
    mode._on_pointer_down(downInfo);
    
    const moveInfo = createPointerInfo(PointerEventTypes.POINTERMOVE, 0, 10, 10, { hit: true, pickedMesh: sphere2 }, 1);
    mode._on_pointer_move(moveInfo);
    
    const upInfo = createPointerInfo(PointerEventTypes.POINTERUP, 0, 10, 10, { hit: true, pickedMesh: sphere2 });
    mode._on_pointer_up(upInfo);
    
    // Should still have 2 atoms, but now 1 bond
    expect(app.system.current_frame.atoms.length).toBe(2);
    expect(app.system.current_frame.bonds.length).toBe(1);
    
    mode.finish();
  });

  test('bond order is used when creating bonds', () => {
    const app = createTestApp();
    
    const atom1 = app.system.current_frame.add_atom('a1', 0, 0, 0, { type: 'C' });
    const atom2 = app.system.current_frame.add_atom('a2', 1, 0, 0, { type: 'C' });
    
    const sphere1 = MeshBuilder.CreateSphere('atom:a1', { diameter: 0.5 }, app.world.scene);
    const sphere2 = MeshBuilder.CreateSphere('atom:a2', { diameter: 0.5 }, app.world.scene);
    
    (app.world.scene.pick as jest.Mock) = jest.fn()
      .mockReturnValueOnce({ hit: true, pickedMesh: sphere1 })
      .mockReturnValueOnce({ hit: true, pickedMesh: sphere2 });
    
    const mode = new EditMode(app);
    mode.bondOrder = 3; // triple bond
    
    const downInfo = createPointerInfo(PointerEventTypes.POINTERDOWN, 0, 0, 0);
    mode._on_pointer_down(downInfo);
    
    const moveInfo = createPointerInfo(PointerEventTypes.POINTERMOVE, 0, 10, 10, undefined, 1);
    mode._on_pointer_move(moveInfo);
    
    const upInfo = createPointerInfo(PointerEventTypes.POINTERUP, 0, 10, 10);
    mode._on_pointer_up(upInfo);
    
    expect(app.system.current_frame.bonds[0].order).toBe(3);
    
    mode.finish();
  });

  test('right click deletes atom', () => {
    const app = createTestApp();
    
    const atom = app.system.current_frame.add_atom('a1', 0, 0, 0, { type: 'C' });
    const sphere = MeshBuilder.CreateSphere('atom:a1', { diameter: 0.5 }, app.world.scene);
    
    (app.world.scene.pick as jest.Mock) = jest.fn().mockReturnValue({
      hit: true,
      pickedMesh: sphere
    });
    
    const mode = new EditMode(app);
    
    const rightClickDown = createPointerInfo(PointerEventTypes.POINTERDOWN, 2, 0, 0, { hit: true, pickedMesh: sphere });
    const rightClickUp = createPointerInfo(PointerEventTypes.POINTERUP, 2, 0, 0, { hit: true, pickedMesh: sphere });
    
    mode._on_pointer_down(rightClickDown);
    mode._on_pointer_up(rightClickUp);
    
    expect(app.system.current_frame.atoms.length).toBe(0);
    
    mode.finish();
  });
});
