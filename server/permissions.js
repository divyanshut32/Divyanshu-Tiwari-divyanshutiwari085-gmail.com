import { forbidden, badRequest } from './http.js';

export const MODE_PERMISSION = {
  view: 'device:view',
  control: 'device:control',
  terminal: 'device:terminal'
};

const catalogue = (db) =>
  db
    .prepare('SELECT key FROM permissions ORDER BY rowid')
    .all()
    .map((r) => r.key);

const membership = (db, orgId, userId) =>
  db
    .prepare(
      'SELECT role,status FROM memberships WHERE org_id=? AND user_id=?'
    )
    .get(orgId, userId);

const expand = (pattern, keys) =>
  pattern === '*'
    ? keys
    : pattern.endsWith(':*')
      ? keys.filter((k) => k.startsWith(pattern.slice(0, -1)))
      : keys.includes(pattern)
        ? [pattern]
        : [];

/*
 * Return grants applicable to a user/org/device.
 *
 * When a specific device is supplied:
 *   - global grants apply
 *   - grants for that exact device apply
 *
 * When no device is supplied:
 *   - only global grants apply
 *
 * resolveDevices() calls this once per device so that
 * device-specific grants are evaluated correctly.
 */
const applicable = (
  db,
  { userId, orgId, deviceId, at }
) => {
  let sql = `
    SELECT
      g.id AS grant_id,
      g.device_id,
      g.effect,
      gp.permission
    FROM grants g
    JOIN grant_permissions gp
      ON gp.grant_id = g.id
    WHERE g.user_id=?
      AND g.org_id=?
      AND g.revoked_at IS NULL
      AND (g.starts_at IS NULL OR g.starts_at<=?)
      AND (g.expires_at IS NULL OR g.expires_at>?)
  `;

  const args = [
    userId,
    orgId,
    at,
    at
  ];

  if (deviceId !== null) {
    sql += `
      AND (
        g.device_id IS NULL
        OR g.device_id=?
      )
    `;

    args.push(deviceId);
  } else {
    /*
     * A permission check without a device must not accidentally
     * receive a device-specific grant.
     */
    sql += `
      AND g.device_id IS NULL
    `;
  }

  return db.prepare(sql).all(...args);
};

const denySet = (
  keys,
  role,
  reason
) => ({
  role,
  permissions: Object.fromEntries(
    keys.map((k) => [
      k,
      {
        effect: 'deny',
        source: null,
        reason
      }
    ])
  )
});

function evaluate(
  keys,
  role,
  base,
  grants
) {
  const denied = new Map();
  const allowed = new Map();

  /*
   * Explicit deny always wins.
   */
  for (const g of grants) {
    if (g.effect !== 'deny') continue;

    for (const k of expand(g.permission, keys)) {
      if (!denied.has(k)) {
        denied.set(k, g.grant_id);
      }
    }
  }

  /*
   * Role permissions.
   */
  for (const k of base) {
    allowed.set(k, `role:${role}`);
  }

  /*
   * Explicit allow grants.
   */
  for (const g of grants) {
    if (g.effect !== 'allow') continue;

    for (const k of expand(g.permission, keys)) {
      if (!allowed.has(k)) {
        allowed.set(k, `grant:${g.grant_id}`);
      }
    }
  }

  return Object.fromEntries(
    keys.map((k) => {
      if (denied.has(k)) {
        return [
          k,
          {
            effect: 'deny',
            source: `grant:${denied.get(k)}`,
            reason: 'explicit_deny'
          }
        ];
      }

      if (allowed.has(k)) {
        return [
          k,
          {
            effect: 'allow',
            source: allowed.get(k),
            reason: null
          }
        ];
      }

      return [
        k,
        {
          effect: 'deny',
          source: null,
          reason: 'implicit'
        }
      ];
    })
  );
}

/*
 * Resolve the complete permission set for one user/org/device.
 */
export function resolve(
  db,
  {
    userId,
    orgId,
    deviceId = null,
    now = new Date()
  }
) {
  const keys = catalogue(db);

  const m = membership(
    db,
    orgId,
    userId
  );

  if (!m) {
    return denySet(
      keys,
      null,
      'not_a_member'
    );
  }

  if (m.status === 'suspended') {
    return denySet(
      keys,
      m.role,
      'suspended'
    );
  }

  if (m.status !== 'active') {
    return denySet(
      keys,
      m.role,
      'inactive_membership'
    );
  }

  const base = db
    .prepare(
      'SELECT permission FROM role_permissions WHERE role=?'
    )
    .all(m.role)
    .map((r) => r.permission);

  const grants = applicable(db, {
    userId,
    orgId,
    deviceId,
    at: now.toISOString()
  });

  return {
    role: m.role,
    permissions: evaluate(
      keys,
      m.role,
      base,
      grants
    )
  };
}

/*
 * Resolve permissions for multiple devices.
 *
 * Each device is evaluated separately so a grant for:
 *
 *     device A
 *
 * does not accidentally unlock:
 *
 *     device B
 */
export function resolveDevices(
  db,
  {
    userId,
    orgId,
    deviceIds,
    now = new Date()
  }
) {
  const keys = catalogue(db);

  const m = membership(
    db,
    orgId,
    userId
  );

  /*
   * Missing/inactive membership means no permissions
   * on any device.
   */
  if (!m || m.status !== 'active') {
    const reason = !m
      ? 'not_a_member'
      : m.status === 'suspended'
        ? 'suspended'
        : 'inactive_membership';

    const permissions = denySet(
      keys,
      m?.role ?? null,
      reason
    ).permissions;

    return {
      role: m?.role ?? null,

      byDevice: Object.fromEntries(
        deviceIds.map((id) => [
          id,
          permissions
        ])
      )
    };
  }

  const base = db
    .prepare(
      'SELECT permission FROM role_permissions WHERE role=?'
    )
    .all(m.role)
    .map((r) => r.permission);

  const at = now.toISOString();

  /*
   * Evaluate each device independently.
   */
  const byDevice = Object.fromEntries(
    deviceIds.map((deviceId) => {
      const grants = applicable(db, {
        userId,
        orgId,
        deviceId,
        at
      });

      return [
        deviceId,
        evaluate(
          keys,
          m.role,
          base,
          grants
        )
      ];
    })
  );

  return {
    role: m.role,
    byDevice
  };
}

/*
 * Simple permission check.
 */
export function can(
  db,
  ctx,
  permission,
  deviceId = null
) {
  const result = resolve(db, {
    userId: ctx.userId,
    orgId: ctx.orgId,
    deviceId
  });

  return (
    result.permissions[permission]?.effect ===
    'allow'
  );
}

/*
 * Throw a 403 when a permission is missing.
 */
export function assertCan(
  db,
  ctx,
  permission,
  deviceId = null
) {
  const result = resolve(db, {
    userId: ctx.userId,
    orgId: ctx.orgId,
    deviceId
  });

  const hit =
    result.permissions[permission];

  if (hit?.effect === 'allow') {
    return;
  }

  if (hit?.reason === 'suspended') {
    throw forbidden(
      'membership is suspended',
      'suspended'
    );
  }

  throw forbidden(
    `missing permission: ${permission}`,
    'missing_permission'
  );
}

/*
 * Check whether a user may grant permissions
 * to another user.
 */
export function assertMayGrant(
  db,
  ctx,
  patterns,
  deviceId = null
) {
  if (patterns.length === 0) {
    throw badRequest(
      'permissions must not be empty'
    );
  }

  if (ctx.userId === ctx.targetUserId) {
    throw forbidden(
      'cannot grant to yourself'
    );
  }

  for (const pattern of patterns) {
    const keys = catalogue(db);

    const needed = expand(
      pattern,
      keys
    );

    if (needed.length === 0) {
      throw badRequest(
        `unknown permission: ${pattern}`,
        'unknown_permission'
      );
    }

    for (const k of needed) {
      if (!can(
        db,
        ctx,
        k,
        deviceId
      )) {
        throw forbidden(
          `cannot grant permission you do not hold: ${k}`,
          'grant_not_held'
        );
      }
    }
  }
}

/*
 * Starting a session requires TWO permissions:
 *
 * 1. session:start
 * 2. the permission associated with the requested mode
 *
 * Both are evaluated against the requested device.
 */
export function assertCanStartSession(
  db,
  ctx,
  mode,
  deviceId
) {
  if (!can(
    db,
    ctx,
    'session:start',
    deviceId
  )) {
    throw forbidden(
      'missing session:start',
      'missing_permission'
    );
  }

  const required =
    MODE_PERMISSION[mode];

  if (!can(
    db,
    ctx,
    required,
    deviceId
  )) {
    throw forbidden(
      `missing ${required}`,
      'missing_device_permission'
    );
  }
}