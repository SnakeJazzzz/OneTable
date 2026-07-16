## Task 6 — code-quality follow-ups (logged 2026-06-26, NOT done in Task 6)

- [x] **cerrado en FF-3, 2026-07-13.** #3 Route-handler behavioral tests for credentials route (401 / JSON-parse 400 /
      unknown-chain 400 / blank-username 400 / `{ ok: true }` PUT shape), mocking `@/auth`
      like sibling routes. DO IN ONE coverage pass across all 4 Portales routes
      (mappings / conflicts / counts / credentials), not one-by-one.
      **UPDATED 2026-07-08:** the mappings route now has FOUR handlers — the pass must
      also cover DELETE (11.5b: 404 not-found / 409 CONFLICTED / requeue side-effect)
      and PATCH (11.6b: 400 invalid body / 404 not-found / 409 CONFLICTED-noop-foreign
      / `{ ok: true }`).
- [x] **cerrado en B-3, 2026-07-14.** #4 `parseChain(body.chain ?? null)` for sibling consistency (mappings/conflicts use `?? null`).
- [x] **cerrado en B-3, 2026-07-14.** #5 `_req: Request` on credentials GET for idiom consistency with sibling GETs.
- [x] **cerrado en B-3, 2026-07-14 (documentado: isActive intacto deliberado; reactivación se decide en Fase 3).** #6 PUT `update: { username }` leaves `isActive` untouched — reactivation question; document or decide.
- [x] **cerrado en B-3, 2026-07-14 (sin `!`: `rows[0]` ya es non-nullable).** #7 test password-absence cast alternative: `Object.keys(row!).not.toContain('password')`.

Items #4-#7 → fold into the B4 whole-branch final review.

## Task 7 — code-quality follow-up (logged 2026-06-26, NOT done in Task 7)

- [x] **cerrado en B-3, 2026-07-14 (+1 test).** #1-minor (file-as-field): when `chain`/`fileType` is sent as a multipart File blob
      (wrong content disposition) the per-file error says "field missing" instead of
      "field must be a plain text value, not a file" — misleading when debugging a
      misconfigured request. Cosmetic; no legitimate client hits it. → fold into the B4
      whole-branch final review.
- [x] **descartado por decisión, 2026-07-14 (re-toca 4 imports por cero ganancia).** (optional) rename `lib/portales/chains.ts` → a portal-metadata name now that it also
      holds FILE_TYPES/parseFileType — deferred to whole-branch review (renaming re-touches
      the 4 Task-4 import sites for no functional gain today).

## Task 8 — code-quality follow-ups (logged 2026-06-26, NOT done in Task 8)

- [x] **descartado por decisión, 2026-07-14 (nota informativa para implementers de Task 10/11, ya vencida).** #5 (use-portales.ts scaffold hooks): useChainMappings/useChainSuggestions/useChainConflicts
      fire their useEffect→refetch on mount; when Task 10/11 first mounts a consumer they hit
      /api/portales/mappings|suggestions|conflicts immediately. Expected — flag so the Task 10/11
      implementer doesn't treat an early error/404 as a hook bug.
- [x] **cerrado en B-3, 2026-07-14 (label htmlFor + id useId-based; input disabled durante upload).** #8 (chain-upload.tsx): the per-slot label <p> is not associated (htmlFor/id) with the
      hidden file <input>; compensated today by the dropzone aria-label. Tie them properly.
      → Task 10/11 / whole-branch review.

## Harness / test-infra follow-ups (logged 2026-07-02)

- [ ] **Isolated DB/schema per process for concurrent local test runs — infra, NOT a Task 13/CI
      blocker.** Root cause (empirically confirmed): running two `pnpm test` processes at once
      against the shared Neon dev DB → one process's seed `TRUNCATE ... RESTART IDENTITY CASCADE`
      (tests/seed/seed.test.ts → scripts/seed.ts main()) deletes the Client/Product rows the other's
      inserts FK-reference → `*_clientId_fkey` violations (~4-7/run; reproduced 2x concurrent →
      both failed). A SINGLE process is deterministically green (187/187, 10/10 on a faithful
      postgres:16 CI mirror). **CI is immune** — `.github/workflows/ci.yml` runs ONE `ci` job with a
      dedicated ephemeral `postgres:16` service + a single `pnpm test` step (not the shared dev DB),
      no matrix/sharding. The flakiness we observed was an ORCHESTRATION artifact (parallel review
      agents each running the suite on the shared dev DB), NOT a CI or test-code defect. Config-layer
      isolation is blocked on this stack: the normalizer issues UNqualified raw SQL that resolves via
      `search_path` (so a per-file Postgres schema does not isolate it), and the local Neon dev DB does
      not permit `CREATE DATABASE`. Real fix = a dedicated database/connection string per test process,
      wired through dev + CI env. Documented inline in `vitest.config.ts` (commit b6348e8). Only needed
      if concurrent local suites are ever run; CI never needs it.
- [ ] **Orchestration process hygiene: confirm zero orphan processes before dispatching an
      implementer.** During the harness task, two implementer subagents came to rest with LIVE
      background processes still running — one was editing `vitest.config.ts` while another hunt ran,
      and lingering `pnpm test` processes polluted a concurrent verification run (the exact
      cross-process gotcha above, in vivo). Before dispatching any implementer that runs tests or
      edits shared config: `ps aux | grep -E "vitest|pnpm test"` and kill stragglers first. Never run
      two test-executing processes against the shared dev DB simultaneously.
- [ ] Higiene git: verificar branch con `git branch --show-current` antes de
      cualquier operación destructiva (reset --hard corrido en branch equivocada,
      2026-07-13; recuperado sin pérdida).

## Task 12 smoke — defectos no bloqueantes (2026-07-08, gate humano)

- [x] **(tachado retroactivo: cerrados por FF-1/FF-2, commits 61ba7f3/83783c3; drift
      documentado en handoff session-b4-followups-end.md)** **PENDING_REVIEW sin salida en UI:** un mapping flaggeado "por verificar" no puede
      confirmarse; hoy solo quitar + re-mapear. El backend ya lo soporta (assignMapping
      idempotente: mismo string + mismo SKU + status CONFIRMED actualiza la fila). Fix
      UI-only: acción "Confirmar" en filas PENDING_REVIEW de Vista B → POST existente.
      **Fast-follow post-merge de B4.**
- [x] **(tachado retroactivo: cerrados por FF-1/FF-2, commits 61ba7f3/83783c3; drift
      documentado en handoff session-b4-followups-end.md)** **Notice de conflicto stale en mapping-section:** el aviso "X generó un conflicto..."
      persiste tras resolver el conflicto en conflict-section hasta refresh manual — el
      refetch unificado actualiza data pero no limpia el notice local. Además falta
      feedback de éxito al resolver ("conflicto resuelto" con el patrón de notice verde
      existente). Fix de estado + notice, **fast-follow post-merge de B4.**

## Session 11.5a-fix / 11.6a / 11.6b — quality-review minors (logged 2026-07-08, none blocking)

Route sweep (fold into the #3 coverage pass or the whole-branch review):

- [x] **cerrado en FF-3, 2026-07-13 (unificado a 404 en el PATCH).** **`PRODUCT_NOT_FOUND` status inconsistency in `app/api/portales/mappings/route.ts`:**
      404 in POST (route.ts:38) vs 409 in PATCH (route.ts:125) for the same semantic error
      code. 404 is the semantically correct one; unify when the file is next touched.
- [ ] **Substring error-matching in route throw-mapping (DELETE + PATCH):** `msg.includes(...)`
      against service error messages is brittle-by-design cosmetic debt (was consistency-
      preserving in 11.5b/11.6b, deliberately NOT "improved" there). Sweep option: error
      codes/classes on the service throws. First written down HERE — earlier briefs said
      "registrado" but no ledger entry existed.

mapping-section.tsx (fold into whole-branch review):

- [x] **cerrado en B-3, 2026-07-14 (B1).** **Shared mutation helper:** `confirmDelete` and `confirmRetarget` duplicate ~25 lines of
      the fetch+parse+branch pattern; the file already extracted `postMapping` for the POST.
      Extract e.g. `mutateMapping(method, body)`.
- [x] **cerrado en B-3, 2026-07-14 (B2).** **Stale edit-state (theoretical):** if the row in inline-edit is removed by an external
      refetch (or "Quitar" on that same row) and the same portalString later reappears in the
      group, the edit panel auto-opens with an empty pick. Harmless (nothing submittable);
      cheap fix: clear `editing` in `confirmDelete`'s success path when `pendingDelete === editing`.
- [x] **cerrado en B-3, 2026-07-14 (B3: prop `loadingLabel`, default 'Borrando…'; mapping-section pasa 'Quitando…').** **ConfirmDialog hardcoded LOADING label:** `components/ui/confirm-dialog.tsx:97` shows
      `'Borrando…'` during loading regardless of action (confirmLabel IS a prop; the loading
      label is not). Parametrize (`loadingLabel` prop). First written down HERE — the 11.5b/11.6b
      briefs referenced it as already-registered debt but no entry existed.

Tests (fold into whole-branch review):

- [x] **cerrado en FF-3, 2026-07-13 (6 matchers agregados).** **Lax `.rejects.toThrow()` (no matcher) in guard tests:** retargetMapping tests
      b4-retarget-4/6/7 don't assert WHICH guard threw (state assertions mitigate). Twin
      pre-existing debt in the deleteMapping tests (same style). Add message matchers in one pass.
- [x] **cerrado en B-3, 2026-07-14 (A6: +1 test en tests/normalizer/resolve.test.ts, cero cambios en core/).** **11.5a-fix edge without its own test:** deleteMapping with count 0 + missing
      `firstSeenUploadId` changed from throw → success (correct by construction — the `if`
      short-circuits the requeue guard); not pinned by an assertion.

Service-design notes (document-or-decide; no action unless a future flow trips them):

- [x] **cerrado en B-3, 2026-07-14 (C2: documentado en comentario en core/normalizer/resolve.ts, comment-only).** **deleteMapping presence signal is productId-scoped:** the revert `where` includes
      `productId: args.productId`, so rows of the string with `productId` NULL yield count 0
      → no requeue. Unreachable in current flows (assignMapping backfills; normalize attributes
      CONFIRMED strings); becomes real only if a future flow creates mappings without backfill.
- [x] **cerrado en B-3, 2026-07-14 (C2: documentado en comentario, comment-only; DRIFT corregido: el guard corre tras UN check de DB — el findFirst del mapping — no dos; `select: { id: true }` bastaría pero no se cambia lógica).** **retargetMapping nits (11.6a quality):** the pure no-op guard (`new === old`) runs after
      two DB checks (defensible error-precedence: not-found → 404 first); the tenancy existence
      check fetches the full Product row where `select: { id: true }` would do.

## FF-1 — minors de review (logged 2026-07-13, no bloqueantes)

- [x] **cerrado en B-3, 2026-07-14 (B2: confirmRow sostiene el flag hasta post-refetch; DRIFT corregido: delete/retarget NO sostienen su flag — lo liberan antes pero cierran su superficie de UI en el mismo paso, así que no tienen ventana de re-click; no se tocaron).** `setConfirming(null)` corre antes del `await onConfirmed`: ventana durante
      el refetch donde los botones se re-habilitan contra data stale.
      Doble-click = segundo POST inocuo (idempotente), pero diverge del
      patrón si delete/retarget sostienen su flag hasta post-refetch.
      Verificar y unificar en whole-branch review.
- [x] **cerrado en B-3, 2026-07-14 (B2: clear en el success path de confirmDelete, junto con `editing`).** `confirmError` stale teórico: si la fila con error desaparece por refetch
      externo y el mismo portalString reaparece, el error re-renderiza.
      Gemelo del "stale edit-state (theoretical)" ya registrado para `editing`
      — mismo fix barato, hacerlos juntos.

## FF-2 — minors de review (logged 2026-07-13, no bloqueantes)

- [ ] Ventana residual si el refetch del POST falla: retry vía refreshKey
      hace setError(null) sincrónico → render transitorio sin error con data
      stale que puede limpiar el notice antes del retry. Solo pierde
      feedback, no corrompe estado. Causa raíz: hooks sin señal de in-flight
      (pre-existente). Candidato whole-branch review o hardening.
- [ ] UX: en la rama conflict el notice aparece un round-trip después
      (tradeoff deliberado del reorden anti-race, documentado en comentario).
- [x] **cerrado en B-3, 2026-07-14 (B4: clear condicional en la transición vacío→poblado de la data refetcheada).** Notice verde de conflict-section persiste indefinido: sin dismiss y
      sin clear al llegar conflictos nuevos — un "Conflicto resuelto." viejo
      puede convivir arriba de una lista fresca de conflictos (mensaje
      contradictorio). Fix barato: clear del notice cuando conflicts pasa de
      vacío a poblado. Whole-branch review.

## B-1 — minors de review (logged 2026-07-14, no bloqueantes)

- [ ] **Pin faltante: override con salePrice NULL** (purchase-only, estado
      legal per schema `Decimal?`) debe caer a base. La cascada lo maneja
      (units × NULL → NULL → COALESCE sigue) pero ningún seed lo pinnea.
      DESTINO: test obligatorio dentro de B-2 (su UI hace alcanzable el
      estado). Una fila de seed extra en money-cascade.test.ts.
- [x] **cerrado en B-3, 2026-07-14 (A7; la línea era :238 post-B2).** **Assertion redundante en money-cascade.test.ts:223** (`not.toBeNull()`
      antes de `toBeCloseTo`). Cosmético; whole-branch review.
- [ ] **Nota documental:** la distinción null-vs-0 a nivel agregado es
      estructural (SUM no distingue); el pin vive en los `toBeNull()`
      per-row de getOneTableRows. Sin acción.

## B-2 — pre-registrados (logged 2026-07-14)

- [x] **cerrado en B-3, 2026-07-14 (A1: ambas rutas migradas al helper con adapters locales `empty`→omit/clear; red de tests A1-bis escrita y verde PRE-migración).** **Unificación del helper de precio**: `lib/prices.ts` (nuevo en B-2) nace
      con regex + cota copiadas VERBATIM de las dos copias module-local de
      parametros (`app/api/parametros/skus/route.ts` y `skus/[id]/route.ts`).
      Migrar ambas rutas al helper compartido en whole-branch review — no-op
      mecánico por diseño (byte-compatibles).
- [x] **cerrado en B-3, 2026-07-14 (A2 — DECISIÓN: cap a 2 decimales en las tres rutas vía regex `/^\d+(\.\d{1,2})?$/` en lib/prices.ts; cierra redondeo silencioso Y desborde Q-6; el importer de Excel queda fuera de scope, divergencia UI-estricta vs import-permisivo documentada en el doc-comment del helper).** **Document-or-decide: decimales ilimitados en la validación de precio.**
      La regex `/^\d+(\.\d+)?$/` acepta decimales ilimitados y Postgres
      redondea silencioso a 2 en numeric(12,2) ("10.999" → 11.00 sin error ni
      aviso). Comportamiento pre-existente en parametros, heredado a sabiendas
      por B-2 (lib/prices.ts). Decidir en whole-branch review: capar a 2
      decimales en validación, o documentar como aceptado.
      **AMPLIADO por review quality B-2 (Q-6):** el redondeo puede DESBORDAR,
      no solo redondear — "9999999999.995" pasa la cota (`Number < 10^10`)
      pero Postgres redondea a 10000000000.00 → 13 dígitos → numeric field
      overflow → P2000 → 500 crudo. Mismo hueco byte-compatible en las copias
      de parametros. Decidir con el cuadro completo.

## B-2 — minors de review (logged 2026-07-14, no bloqueantes)

Carril spec (1):

- [ ] Guard extra no pedido por el brief: check de tipo de `productId`
      (no-string/vacío → 400 INVALID_BODY) en price-overrides PUT, insertado
      entre "4 keys" y "chain". Declarado en el self-report; no reordena los
      guards especificados y evita un 500 de Prisma. Sin acción — registrado
      solo como desvío documentado.

Carril quality (Q-2 a Q-5, Q-7, Q-8; Q-1 fue a fix pass; Q-6 amplió la nota
de decimales en la sección "B-2 — pre-registrados"):

- [ ] **Q-2 — race de refetch compartido entre saves de filas distintas**
      (price-override-section + useChainPriceOverrides): dos saves dentro de
      un RTT pueden dejar el estado del hook en la respuesta stale (la data
      persistida es correcta; se auto-repara al próximo refetch/remount).
      Deuda de patrón compartida con los hooks hermanos sin señal de
      in-flight (misma familia que los minors de FF-1/FF-2). Whole-branch
      review o hardening.
- [x] **cerrado en B-3, 2026-07-14 (B5; mecanismo final post fix-pass I-1, 2026-07-15: deps por valor + `syncEpoch` per-row — el save exitoso bumpea el epoch de SU fila y re-sincroniza al canónico; los refetches NO tocan el tipeo sin guardar de filas hermanas. El mecanismo intermedio "keyed a identidad de row" fue revertido por regresión I-1, ver b5-3-review-quality.md).** **Q-3 — dirty perpetuo por canonicalización Decimal**: input "80.00"
      contra server "80" queda dirty tras save exitoso (deps del useEffect no
      cambian → el input no se re-sincroniza) → "Guardar" habilitado
      conviviendo con "Guardado ✓". Cosmético e idempotente. Fix barato:
      re-sync incondicional al resolver save() o comparación normalizada.
      Nota para el smoke de Michael: es observable en UI.
- [x] **cerrado en B-3, 2026-07-14 (B6: comentario reescrito a lo que el código garantiza, coherente con B5).** **Q-4 — comentario de éxito promete más de lo que garantiza**
      (price-override-section:447-449): refetch del hook nunca rechaza, así
      que el ✓ puede setearse sin re-sync real; en ese caso el error de
      sección desmonta la lista y el ✓ no se ve. Comportamiento aceptable,
      comentario engañoso — ajustar cuando se toque el archivo.
- [ ] **Q-5 — TOCTOU ownership→upsert en price-overrides PUT**: Product
      borrado entre findFirst y upsert → P2003 → 500 crudo. Mismo
      check-then-act que mappings POST (paridad deliberada), ventana
      milimétrica. Sin acción en B-2; candidato al sweep de error
      codes/classes ya registrado para las rutas.
- [ ] **Q-7 — parsePriceInput acepta arrays de un elemento**
      (`String([5])` → "5"): coerción heredada verbatim de parametros,
      paridad deliberada. Endurecer a `string | number | null` cuando se
      unifique el helper (entrada ya registrada arriba).
- [x] **cerrado en B-3, 2026-07-14 (A3: +1 test, `purchasePrice: 12.34` numérico → 200 y persiste "12.34").** **Q-8 — gap de test: precio numérico (no-string) en el PUT**: la ruta
      acepta `purchasePrice: 12.34` por diseño pero ningún test lo pinnea;
      una refactor a string-only rompería clientes numéricos sin detección.
      Una línea de test. Whole-branch review.

## B-3 — minors de review (logged 2026-07-15, no bloqueantes)

Carril spec: 3 minors, todos desvíos DECLARADOS evaluados como consecuencia
necesaria (fix de firma en portales-credentials-handler.test.ts post-A4;
matcher sin `!` de fuerza equivalente; disabled={isUploading} en B7). Sin
acción — documentados en b5-3-review-spec.md.

Carril quality (I-1 fue a fix pass; M-4 acoplado al fix):

- [ ] **M-1 — test Q-8 acoplado al orden**: el test de precio numérico reusa
      el fixture `pUpdate` y deja muerta la rama create del test de upsert si
      se reordena. Desacoplar fixtures cuando se vuelva a tocar el archivo.
- [x] **cerrado en B-3, 2026-07-15, decisión post-smoke de Michael (mensaje
      nuevo en las 3 rutas: "El precio debe ser un número no negativo, con
      máximo 2 decimales."; auto-corrección de input RECHAZADA — transformar
      dinero en silencio fabrica un número no tipeado; hint client-side
      queda en hardening).** **M-2 — mensaje INVALID_PRICE impreciso post-A2**: el mensaje
      compartido no menciona el cap de 2 decimales y no hay validación
      client-side que lo anticipe — el usuario que tipea "10.999" recibe
      "números decimales no negativos" sin pista del cap. Candidato:
      actualizar mensaje (y opcional hint client-side) en hardening
      post-merge.
- [ ] **M-3 — doble path de apertura del picker en chain-upload**: el click
      del label nuevo (B7) burbujea al dropzone → segundo `input.click()`.
      Esperable no-op por el click-in-progress del spec, pero es path nuevo.
      VERIFICAR EN EL SMOKE de Michael: el picker abre UNA sola vez al
      clickear el label. Si abre dos veces, promover a fix.
