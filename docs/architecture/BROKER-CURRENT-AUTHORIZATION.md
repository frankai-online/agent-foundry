# Release-blocking broker authorization persistence correction

CI on PR 28 exposed a pre-existing defect, reproduced on a disposable PostgreSQL
database with the unchanged baseline broker implementation. The credential broker
could authorize using a stale token snapshot because the historical audit trigger
compares revocation with caller-supplied evaluatedAt. Exact receipt replay also
returned before checking current durable state.

For AUTHORIZED decisions, the application persistence API now locks the matching
token and active workspace binding, rejects revoked tokens, validates identity
linkage, and checks token validity against clock_timestamp() after locks are
acquired. This runs before both existing-receipt return and new insertion.
Historical EXECUTED audit persistence keeps its prior semantics.

The fixture's valid timestamps are relative to the database clock. Explicit
negative cases retain historically valid but currently revoked/expired snapshots
and exact authorization receipt replay after revocation or binding disable.
No secret resolver may run in these denied cases.

No existing migration was edited and no migration is introduced. This is a
persistence-API boundary, not a universal raw-SQL invariant: migration 0013 retains
historical audit semantics for direct INSERTs. It also does not provide an atomic
execution fence from authorization commit through secret resolution and external
consumption. The credential broker core is not newly wired into an execution
adapter by this release.

The unrelated DB package tests require seeded package/publication fixtures.
An initial run against a migration-only database failed those fixture prerequisites;
after exercising the deterministic controlled-distribution harness in an isolated
container network, all three database tests passed without skips.

A subsequent broad test run also exposed the reclaim test prerequisite: its queue
must be isolated from storage retry jobs left by the distribution harness.
Only the disposable verification database queue was cleared before the final
workspace run; no production data or test assertions were changed.
