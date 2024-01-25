import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import Molvis from 'molvis';

@Component({
  selector: 'app-molvis',
  standalone: true,
  templateUrl: './molvis.component.html'
})
export class MolvisComponent implements OnInit {

  @ViewChild('rendererCanvas', { static: true })
  public rendererCanvas: ElementRef<HTMLCanvasElement>;

  public constructor() { }

  public ngOnInit(): void {
    const app = new Molvis(this.rendererCanvas.nativeElement);
    app.run();
  }
}