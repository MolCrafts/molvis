import { Component } from '@angular/core';
import { MolvisService } from './molvis.service';

@Component({
  selector: 'app-molvis',
  standalone: true,
  imports: [],
  templateUrl: './molvis.component.html',
  styleUrl: './molvis.component.scss'
})
export class MolvisComponent {
  constructor(private molvisService: MolvisService) { }
  ngOnInit() {
    const canvas = document.getElementById('molvis-canvas') as HTMLCanvasElement;
    const molvis = this.molvisService.init(canvas);
    molvis.run();
  }
}
