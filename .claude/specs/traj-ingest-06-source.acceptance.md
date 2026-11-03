---
spec: traj-ingest-06-source
created: 2026-08-18
criteria:
  - id: ac-001
    summary: DataSource has no kind field
    type: code
    pass_when: |
      DataSource and its subclasses in stage/src/pipeline/data_source.ts
      do not declare kind or DataSourceKind. Public stage index does not
      export DataSourceKind.
    status: pending
  - id: ac-002
    summary: Call sites use instanceof, not kind strings
    type: runtime
    pass_when: |
      stage/tests/pipeline/data_source.test.ts is green and distinguishes
      File/Memory/Stream via instanceof only; no expect(ds.kind).
    status: pending
  - id: ac-003
    summary: Project snapshot does not persist DataSourceKind
    type: code
    pass_when: |
      ProjectDataSourcePayload has no kind: DataSourceKind. serialize.ts
      and rpc/router.ts do not write ds.kind.
    status: pending
  - id: ac-004
    summary: ssh and http are not DataSource types and not molrs
    type: code
    pass_when: |
      No SshDataSource/HttpDataSource class. @molcrafts/molvis-core/molrs
      has no DataSourceKind/ssh/http acquisition types.
    status: pending
  - id: ac-005
    summary: Regression locks the no-kind export
    type: runtime
    pass_when: |
      regressions/traj-ingest-06-source.ts exits 0; DataSourceKind is
      not an export of @molcrafts/molvis-stage; a constructed
      FileDataSource has no kind own-property.
    status: pending
out_of_scope:
  - New DataSource subclasses
  - MolRS API changes
  - decideIngest
---

# Acceptance — traj-ingest-06-source

Done = 多态在子类上；没有 kind 枚举可把 ssh/http 塞进去；MolRS 仍对 DataSource 一无所知。
