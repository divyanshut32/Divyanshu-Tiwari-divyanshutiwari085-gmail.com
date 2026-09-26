# DECISIONS

One section per decision that a reviewer might reasonably have made differently. Every section has
the same four parts, and the third and fourth are the ones we weigh most.

Rules, from `DISCOVERY-BRIEF.md`:

- cite something real in `Why` — a commit, a test, an error string, a file and line
- do not restate what a document says; describe what you did when the documents ran out
- six to twelve decisions is the expected range

---

### <the decision, as a claim — not "permissions", but "the org-level view counts device-scoped grants">

**What I chose:**
**Why:** _(evidence: test, log line, commit)_
**What I rejected:** _(the plausible alternative, and the specific reason it fails)_
**What would change my mind:**

<!-- Copy the block above per decision. The two stubs below show the required shape and contain no
     engineering content — replace or delete them. -->

---

### Stub — the shape of a weak "Why"

**What I chose:** the obvious thing.
**Why:** it is what the brief says to do.
**What I rejected:** nothing, the alternative seemed worse.
**What would change my mind:** I do not know.

_Reads as a memory of the document, not a model of the system. Scores nothing._

---

### Stub — the shape of a strong "Why"

**What I chose:** X.
**Why:** I implemented Y first, because Y is the intuitive precedence rule. `node scripts/check-
permissions.js` reported `<the actual reason string it reported>` on the case where the two grants
disagree. That is only reachable if the two are evaluated in a different order than Y assumes.
Moved to X in `<commit>` and the case passed. Logged in `BUILD-LOG.md` under Phase 2.
**What I rejected:** Y, and also "resolve the narrower one last" — both fail the same case for the
same reason.
**What would change my mind:** a case where a narrower grant is expected to survive a broader
refusal. I could not construct one, which is itself evidence for X.

_Shows what you believed, what disproved it, and what you did next._

---

## Where this repo argues with itself

The schema and the written model agree on the major authorization invariants I implemented. I did not change `db/schema.sql` or `db/reference.sql`. One practical tension remains: the prose describes roughly thirty endpoints while the starter leaves route registration empty; I treated the endpoint table in `BRIEF.md §5.1` as the route contract and the schema as the storage contract.

## Decisions

### The JWT carries authorization inputs, not resolved permissions
**What I chose:** Keep `sub`, `org`, `role`, and `pv` in the token and resolve permissions from SQLite on each request.
**Why:** `server/permissions.js` can then read the candidate-specific role/permission overlay at runtime, while `verifyAccessToken` only authenticates the signed claims. The supplied JWT suite passed 43/43 after this split.
**What I rejected:** Embedding the permission set in the JWT; that would make grant/role changes stale until token expiry and would duplicate the server's source of truth.
**What would change my mind:** A requirement that authorization remain valid without a database read on each request.

### Cross-org access is rejected in request context, before route handlers
**What I chose:** Compare every `:org` route parameter to the token's `org` claim in `authenticate()`.
**Why:** This makes the other organization structurally invisible instead of relying on every query to remember a second filter.
**What I rejected:** Letting handlers authorize the caller and then filtering rows; one missed query would turn into a data leak.
**What would change my mind:** A requirement for a single token to address multiple organizations without minting a new token.

### Deny wins before allow
**What I chose:** Expand all deny grants first, then consider the role baseline and allow grants.
**Why:** The resulting permission object can preserve `grant:<id>` as the source of an explicit denial while still allowing a device-specific grant to widen authority only where no deny applies.
**What I rejected:** Choosing the most specific grant or letting the last matching grant win; both make precedence depend on row ordering/scope and are difficult to reason about.
**What would change my mind:** A test case requiring a narrower allow to override a broader deny.

### The database arbitrates exclusive sessions
**What I chose:** Insert the session and catch the partial unique-index violation for `control`/`terminal`.
**Why:** The schema already contains the concurrency guarantee; a check followed by an insert would have a race window.
**What I rejected:** `SELECT` for an existing active session followed by `INSERT`.
**What would change my mind:** Removal of the unique index from the grading schema.

### Permission changes bump `perm_version`, but do not end sessions
**What I chose:** Bump the target membership version for role/grant changes and leave existing sessions alone.
**Why:** This gives the next request a stale token while preserving the session snapshot and TTL.
**What I rejected:** Terminating every session whenever a grant changes; that would collapse the distinction between permission changes and account/tenancy events.
**What would change my mind:** A requirement that role/grant changes immediately interrupt live sessions.

### Device rows are filtered by `device:view` rather than redacted
**What I chose:** Exclude rows when the resolved device-level permission denies `device:view`.
**Why:** The public API check explicitly expects `kiosk-lobby-01` to be absent for the viewer rather than present with hidden fields.
**What I rejected:** Returning every device with sensitive fields blanked.
**What would change my mind:** A UI contract that explicitly required a count of inaccessible devices.

### The frontend consumes resolved permissions rather than roles
**What I chose:** Navigation and device actions derive presence from `permissions[permission].effect`.
**Why:** The UI architecture test rewrites the server response to `deny`; the corresponding element must disappear without changing the role.
**What I rejected:** A React-side `role === ...` permission matrix.
**What would change my mind:** Moving authorization decisions to a server-rendered page where the client never receives permission data.

### Audit denials at the authorization boundary
**What I chose:** `auditDenials()` catches only HTTP 403 permission failures and records them before rethrowing.
**Why:** The supplied API checks require the audit log to contain denied attempts and a reason code.
**What I rejected:** Logging only successful mutations or logging every internal permission check, which would either lose denied activity or create duplicate/noisy events.
**What would change my mind:** An audit contract that required every read or every internal check to be a separate event.

## Deliberately not built

- Real remote-control functionality, shell execution, input injection, or screen capture: explicitly outside the task.
- Rate limiting and password reset: explicitly outside the supplied scope.
- Production email delivery: invite tokens are returned by the API for this exercise.
