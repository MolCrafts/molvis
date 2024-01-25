import { Component } from '@angular/core';
import { MolvisComponent } from './molvis/molvis.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MolvisComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {

}