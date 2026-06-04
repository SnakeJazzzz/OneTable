# Migrations — hand-edited SQL

Some indexes in this project are **partial** or use **NULLS NOT DISTINCT**, which
Prisma does not generate from `schema.prisma`. They are hand-edited into the
migration SQL after `prisma migrate dev --create-only`. Do NOT regenerate or drop
them on a later `migrate dev` — if Prisma proposes dropping one of these, discard
that change.

| Index | Migration | Why hand-edited |
|---|---|---|
| `sellout_unique_idx` (`NULLS NOT DISTINCT`) | `20260518170659_init` | Postgres `NULLS NOT DISTINCT` not expressible in Prisma schema. |
| `ProductMapping_active_unique` (partial, `WHERE status <> 'CONFLICTED'`) | `fase2_b1_schema` | Partial unique index for conflict resolution (spec §4.4 / §8). |
