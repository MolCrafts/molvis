import { TestBed } from '@angular/core/testing';

import { MolvisService } from './molvis.service';

describe('MolvisService', () => {
  let service: MolvisService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MolvisService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
