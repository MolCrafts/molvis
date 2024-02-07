import { Injectable } from '@angular/core';
import Molvis from 'molvis';

@Injectable({
  providedIn: 'root'
})
export class MolvisService {

  constructor() { }
  init(canvas: HTMLCanvasElement) {
    const molvis = new Molvis(canvas);
    return molvis;
  }
}
