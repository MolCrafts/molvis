# Design preferences — full text

CLAUDE.md carries the one-line index of these rules. This file is the detail.

**Default for all MolCrafts projects.** Apply unless the operator **explicitly**
requires a functional (or other) style for a named subsystem — then capture the
exception with `/mol:note` and scope it. Do **not** invent a functional style on
your own.

## Iron law — no silent debt

Discover anti-pattern / failing test / broken invariant / clear bug in the
surface you touch or depend on → **prioritize or hard-stop**:

1. **Do not ignore** ("pre-existing, leave it"), skip-mark, weaken asserts, or
   land features on known rot.
2. **Fix now** if local + stage-allowed; else **stop**, report path:line, route
   `/mol:debug` / `/mol:refactor` / supersede.
3. **Name it** in the summary (found / fixed / blocking). Silence = process
   failure.

Outranks "stay in scope" / "minimal diff" when those mean knowingly leaving rot
you already saw.

## Iron law — high cohesion, low coupling

**Every module** (file / type / package) is a self-contained unit. A **product**
iron law, not optional style; it applies to every file, not only "important" ones.

- **High cohesion** — one clear responsibility; everything in the module serves
  it. Split when a unit accumulates more than one coherent job.
- **Low coupling** — depend only on narrow, explicit interfaces (constructor
  args, method params, small protocols). No reach-through into other modules'
  internals; no ambient god context; no hidden global registries required to
  exercise the unit.

**Unit-test consequence (hard):** proving a module works uses **only that
module's unit tests**, with fakes/stubs for outbound deps. The loop is
`npm run test:<package>` scoped to that package — **not** full-suite, **not**
cross-module regression. The full suite is a CI net; it is not how you green a
unit during design. (There are no e2e lanes — unit tests run in headless
chromium via `@rstest/browser`, which is a browser *environment* for unit
bodies, not a browser driver.)

If a change "only works when the whole suite runs", or a unit test must boot
sibling plugins, the host shell, network, or external processes → the design is
too coupled. **Stop**, split the boundary, inject the dependency, or route
`/mol:refactor`. Do not "fix it with more integration tests."

## Prefer

- **OOP by default.** Domain concepts are types with methods, not free-floating
  helpers. Module-level functions only for true free operations or thin
  package re-exports.
- **Primitive, single-responsibility public APIs.** Callers compose: construct →
  configure → one concern → read result.
- **Inline until the second real use.** Extract only at a second call site, or
  when a unit test must target that unit.
- **Testable-in-isolation boundaries.** Dependencies enter through explicit
  seams so the unit can be exercised with fakes. A module you cannot unit-test
  without its real graph is unfinished design.

## Forbid

- **Factory functions as the primary constructor story.** Prefer `Foo(...)`.
  Explicit alternate constructors only when they have distinct semantics
  (`Foo.from_file`, `Foo.empty`).
- **God data structures.** No mega-dict / ambient "context" blob.
- **All-in-one façade APIs.** Composition is the caller's job.
- **Coupling that forces full-graph testing.** No hidden cross-module state,
  import-time side effects, or hard-wired concrete collaborators that make a
  single workspace's tests insufficient.

## Shape check (before adding a public symbol)

1. Natural owning type? → method on that type, not a free function.
2. More than one user-visible step? → split into primitives.
3. Only one in-tree call site? → do not extract.
4. Tempted to hang another field on a "context" bag? → new parameter or smaller
   type instead.
5. Can this unit's tests pass with fakes only? If no → redesign the seam.

## Tests

Unit tests **only** under `*/tests/`, path mirrors source, types mirror types
(`FooClass` → `TestFooClass`). Single-function tests. One module → its mirrored
tests only. Details: `tester` agent.
