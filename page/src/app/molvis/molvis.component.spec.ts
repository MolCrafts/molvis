import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MolvisComponent } from './molvis.component';

describe('MolvisComponent', () => {
  let component: MolvisComponent;
  let fixture: ComponentFixture<MolvisComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MolvisComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(MolvisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
