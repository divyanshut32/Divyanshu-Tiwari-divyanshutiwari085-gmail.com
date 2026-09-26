# BUILD-LOG

Append to this as you go. Commit it with the code it describes — the timestamps are part of the
evidence, and a log that arrives in one commit at the end reads as what it is.

Five lines is a real entry. Short and dated is better than long and reconstructed.

The categories we look for are listed in `DISCOVERY-BRIEF.md`. The example below shows the
*shape* of a good entry; it is a recreation of something already printed in `README.md`, so it
gives nothing away.

---

<!-- EXAMPLE — delete this block, keep the shape.

## 2026-03-04 · Phase 0 — orientation

Expected the unknown-permission test to fail on my validation code.
Observed: it passed, with foreign_keys ON, and *also* passed with the pragma removed — so the
check was never running, and the "pass" was the schema loading fine while enforcing nothing.
Changed: moved `foreign_keys = ON` to connection open and re-ran; now it raises
`FOREIGN KEY constraint failed` as the README said it would.
Note: this is the failure mode where a passing test is worse than a failing one.

-->

## Phase 0 — orientation

- 2026-09-26: The starter is intentionally incomplete: `server/auth.js`, `context.js`, `permissions.js`, `lifecycle.js`, `audit.js`, route registration, and the React console are all missing/stubbed.
- I initially tried to run the public suites before installing dependencies; the first failure was `ERR_MODULE_NOT_FOUND` for `better-sqlite3`, so that was an environment/setup failure rather than evidence about the implementation.
- The database connection already enables `foreign_keys`, WAL, busy timeout, and `synchronous=NORMAL`; I left the schema untouched and kept validation in the application only where the schema cannot express the rule.

## Phase 1 — token verification

- Implemented `verifyAccessToken` from the explicit rejection matrix rather than trusting the JWT header.
- The public JWT suite now reports **43 passed, 0 failed**. The useful edge case was `exp == now`: it must be rejected, so the check is `<=`, not `<`.
- Signature comparison uses `timingSafeEqual` after checking equal lengths, and issuer/audience/JTI are checked after the signature.

## Phase 2 — caller context and the resolution engine

- The authorization model is keyed by `(userId, orgId)`; the token's `org` claim is treated as the structural boundary before route handlers run.
- The resolution implementation reads the permission catalogue, role baseline, and grants from SQLite at runtime. It does not encode the documented role matrix, which matters because the loader adds a candidate-specific role and permission.
- I kept one resolution path for both single-device checks and the batched device list. The batched form loads the catalogue, membership, baseline, and applicable grants once, then filters in memory per device.

## Phase 3 — orgs, members, invites

- Implemented membership role changes, suspension/reinstatement, removal/leave, organization creation/update/delete, invite creation/peek/accept/cancel, and effective-permission lookup.
- A role change or grant change bumps `perm_version`; suspension/removal also end active sessions. Permission changes do not end sessions.
- Invite tokens are stored only as hashes and are returned only from the creation response.

## Phase 4 — devices and grants

- Device rows are filtered by the resolved `device:view` permission rather than returned as redacted rows.
- Grant validation checks target membership and device ownership before authorization, preserving the 404 isolation rule. Unknown grant patterns are rejected as `400 unknown_permission` rather than becoming a silent deny.
- Denies are evaluated before allows, and device-scoped grants are only considered for their device (while the org-level view can see whether a permission exists on at least one device).

## Phase 5 — sessions

- Session creation checks `session:start` separately from the mode permission so failures can report `missing_permission` versus `missing_device_permission`.
- Exclusive `control`/`terminal` sessions rely on the database partial unique index rather than a check-then-insert race. `view` sessions are not exclusive.
- Active sessions are grandfathered on permission/role changes; expiry, suspension, removal, and device deletion/transfer are handled as lifecycle events.

## Phase 6 — audit

- Audit writes are append-only inserts. Permission denials are captured by the shared `auditDenials` wrapper before the error is rethrown.
- Success rows are written at the operation boundary so one action produces one success record instead of one record per permission check.

## Phase 7 — the console

- The React console uses the server's resolved permission objects to decide whether navigation cards and device actions exist. There is no role-to-permission matrix in the frontend.
- Access tokens remain in a module variable; the refresh token is a cookie and reload restores the session through `/auth/refresh`.
- The UI implements the fixed test attributes for org identity, device rows, permission actions, grants, admin controls, and invite acceptance.

## Phase 8 — hardening

- Syntax validation passes for all server modules and the supplied JWT suite passes 43/43.
- Full SQLite/API/UI execution could not be completed in this working environment because the uploaded project did not contain a usable native `better-sqlite3` installation and package installation timed out. I am not recording those suites as passed.
- Before submission, run `npm install`, `npm run db:reset`, `node scripts/check-jwt.js`, `node scripts/check-permissions.js`, `node scripts/check-api.js`, and `npx playwright test` from the actual candidate repository.

## Open threads

- The local environment still needs a successful dependency install before the API and Playwright suites can be executed.
- The transfer endpoint needs a final hidden-test review for the “provision in both orgs” requirement.
- The final repository must be public and retain the commit history; this working copy has not been pushed to the candidate's GitHub repository yet.
