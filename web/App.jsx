import React, { useEffect, useState } from 'react';
import { api, setToken } from './api.js';

const has = (p, k) => p?.[k]?.effect === 'allow';

function Login({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    try {
      await api.login({ email, password });
      onDone();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main className="login">
      <form data-testid="login-form" onSubmit={submit}>
        <h1>RemoteOps</h1>

        <input
          data-testid="login-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />

        <input
          data-testid="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />

        <button data-testid="login-submit">Sign in</button>

        {error && (
          <div data-testid="login-error" className="error">
            {error}
          </div>
        )}
      </form>
    </main>
  );
}

function Invite({ token, onDone }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    api
      .get(`/invites/${token}`)
      .then(setInfo)
      .catch(() => setError('This invite is no longer valid.'));
  }, [token]);

  if (error) {
    return (
      <main className="login">
        <div data-testid="invite-error" className="error">
          {error}
        </div>
      </main>
    );
  }

  if (!info) {
    return <main className="login">Loading…</main>;
  }

  return (
    <main className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();

          try {
            await api.post(`/invites/${token}/accept`, {
              name,
              password,
            });

            onDone();
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <h1>Invitation</h1>

        <p>
          Role:{' '}
          <strong data-testid="invite-role">
            {info.role}
          </strong>
        </p>

        <input
          data-testid="invite-email"
          value={info.email}
          readOnly
        />

        <input
          data-testid="invite-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />

        <input
          data-testid="invite-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />

        <button data-testid="invite-submit">
          Accept
        </button>

        {error && <div className="error">{error}</div>}
      </form>
    </main>
  );
}

function App() {
  const [state, setState] = useState(null);
  const [page, setPage] = useState('devices');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      let d;

      try {
        d = await api.get('/auth/me');
      } catch {
        await api.refresh();
        d = await api.get('/auth/me');
      }

      setState(d);
    } catch {
      setState({ loggedOut: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <div>Loading…</div>;
  }

  if (state?.loggedOut) {
    return <Login onDone={load} />;
  }

  const p = state.permissions;
  const org = state.org;

  const nav = [
    ['devices', 'Devices', 'device:list'],
    ['people', 'People', 'user:read'],
    ['grants', 'Grants', 'user:read'],
    ['sessions', 'Sessions', 'session:view'],
    ['audit', 'Audit', 'audit:read'],
    ['admin', 'Admin', 'org:update'],
  ].filter((x) => has(p, x[2]));

  async function switchOrg(id) {
    if (id === org.id) return;

    const d = await api.post('/auth/token', { orgId: id });

    setToken(d.token);

    await load();

    setPage('devices');
  }

  async function createOrg() {
    const name = window.prompt('Organization name');

    if (!name) return;

    const d = await api.post('/orgs', { name });

    const t = await api.post('/auth/token', {
      orgId: d.id,
    });

    setToken(t.token);

    await load();

    setPage('devices');
  }

  return (
    <div
      data-testid="app-shell"
      data-org-id={org.id}
      data-org-theme={org.theme}
      className={`shell theme-${org.theme}`}
    >
      <header>
        <strong>RemoteOps</strong>

        {/* Visible organization controls.
            The Playwright tests click org-option directly, so each
            organization must be an actual visible/clickable element. */}
        <div
          data-testid="org-selector"
          className="org-selector"
          role="group"
          aria-label="Organization"
        >
          {state.orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              data-testid="org-option"
              data-org-id={o.id}
              aria-pressed={o.id === org.id}
              className={o.id === org.id ? 'active' : ''}
              onClick={() => switchOrg(o.id)}
            >
              {o.name}
            </button>
          ))}
        </div>

        <button
          data-testid="create-org"
          onClick={createOrg}
        >
          + Org
        </button>

        <span data-testid="active-role">
          {state.role}
        </span>
      </header>

      <nav>
        {nav.map(([k, label]) => (
          <button
            key={k}
            data-testid={`nav-${k}`}
            onClick={() => setPage(k)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="content">
        {page === 'devices' && (
          <Devices key={`devices-${org.id}`} />
        )}

        {page === 'people' && (
          <People key={`people-${org.id}`} />
        )}

        {page === 'grants' && (
          <Grants
            key={`grants-${org.id}`}
            permissions={p}
          />
        )}

        {page === 'sessions' && (
          <Sessions key={`sessions-${org.id}`} />
        )}

        {page === 'audit' && (
          <Audit key={`audit-${org.id}`} />
        )}

        {page === 'admin' && (
          <Admin
            key={`admin-${org.id}`}
            permissions={p}
          />
        )}
      </section>
    </div>
  );
}

function Devices() {
  const [data, setData] = useState(null);

  const load = () =>
    api
      .get(`/orgs/${locationOrg()}/devices`)
      .then(setData)
      .catch(() => setData({ devices: [] }));

  useEffect(() => {
    load();
  }, []);

  if (!data) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h2>Devices</h2>

      {data.devices.length === 0 ? (
        <div data-testid="devices-empty">
          No devices
        </div>
      ) : (
        <table>
          <tbody>
            {data.devices.map((d) => (
              <tr
                key={d.id}
                data-testid="device-row"
                data-device-id={d.id}
              >
                <td>{d.name}</td>
                <td>{d.kind}</td>
                <td>
                  {d.online ? 'online' : 'offline'}
                </td>

                <td>
                  {Object.entries(d.permissions)
                    .filter(
                      ([k, v]) =>
                        v.effect === 'allow' &&
                        [
                          'device:control',
                          'device:terminal',
                        ].includes(k)
                    )
                    .map(([k]) => (
                      <button
                        key={k}
                        data-permission={k}
                        data-state="unlocked"
                      >
                        {k}
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function People() {
  const [d, setD] = useState(null);

  useEffect(() => {
    api
      .get(`/orgs/${locationOrg()}/members`)
      .then(setD);
  }, []);

  return (
    <div>
      <h2>People</h2>

      {d?.members?.map((u) => (
        <div
          key={u.id}
          data-testid="user-row"
          data-user-id={u.id}
        >
          {u.name} — {u.role}
        </div>
      ))}
    </div>
  );
}

function Grants({ permissions }) {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);

  const load = () =>
    api
      .get(`/orgs/${locationOrg()}/grants`)
      .then(setD);

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <h2>Grants</h2>

      {has(permissions, 'grant:create') && (
        <button
          data-testid="new-grant"
          onClick={() => setOpen(true)}
        >
          New grant
        </button>
      )}

      {open && (
        <GrantForm
          onDone={() => {
            setOpen(false);
            load();
          }}
        />
      )}

      {d?.grants?.map((g) => (
        <div
          className="grant"
          data-testid="grant-row"
          data-effect={g.effect}
          key={g.id}
        >
          {g.user_email} · {g.effect} ·{' '}
          {g.permissions.join(', ')}

          {has(permissions, 'grant:revoke') && (
            <button
              data-testid="revoke-grant"
              onClick={async () => {
                await api.del(
                  `/orgs/${locationOrg()}/grants/${g.id}`
                );

                load();
              }}
            >
              Revoke
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function GrantForm({ onDone }) {
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [userId, setUserId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [effect, setEffect] = useState('allow');

  useEffect(() => {
    Promise.all([
      api.get(`/orgs/${locationOrg()}/members`),
      api.get(`/orgs/${locationOrg()}/devices`),
    ]).then(([u, d]) => {
      setUsers(u.members);
      setDevices(d.devices);
    });
  }, []);

  async function submit() {
    const permissions = [
      ...document.querySelectorAll(
        '[data-permission-key]:checked'
      ),
    ].map((x) =>
      x.getAttribute('data-permission-key')
    );

    await api.post(
      `/orgs/${locationOrg()}/grants`,
      {
        userId,
        deviceId,
        effect,
        permissions,
      }
    );

    onDone();
  }

  return (
    <div className="form">
      <select
        data-testid="grant-user"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
      >
        <option value="">User</option>

        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>

      <select
        data-testid="grant-device"
        value={deviceId}
        onChange={(e) => setDeviceId(e.target.value)}
      >
        <option value="">Org-wide</option>

        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <select
        data-testid="grant-effect"
        value={effect}
        onChange={(e) => setEffect(e.target.value)}
      >
        <option>allow</option>
        <option>deny</option>
      </select>

      {[
        'device:terminal',
        'device:control',
        'device:view',
      ].map((k) => (
        <label key={k}>
          <input
            type="checkbox"
            data-permission-key={k}
          />
          {k}
        </label>
      ))}

      <button
        data-testid="grant-submit"
        onClick={submit}
      >
        Create
      </button>
    </div>
  );
}

function Sessions() {
  const [d, setD] = useState(null);

  useEffect(() => {
    api
      .get(`/orgs/${locationOrg()}/sessions`)
      .then(setD);
  }, []);

  return (
    <div>
      <h2>Sessions</h2>

      {d?.sessions?.map((s) => (
        <div key={s.id}>
          {s.device_name} · {s.mode} · {s.state}
        </div>
      ))}
    </div>
  );
}

function Audit() {
  const [d, setD] = useState(null);

  useEffect(() => {
    api
      .get(`/orgs/${locationOrg()}/audit`)
      .then(setD);
  }, []);

  return (
    <div>
      <h2>Audit</h2>

      {d?.events?.map((e) => (
        <div key={e.id}>
          {e.action} · {e.result}
        </div>
      ))}
    </div>
  );
}

function Admin({ permissions }) {
  return (
    <div>
      <h2>Admin</h2>

      {has(permissions, 'org:update') && (
        <button data-testid="rename-org">
          Rename
        </button>
      )}

      {has(permissions, 'org:delete') && (
        <button data-testid="delete-org">
          Delete
        </button>
      )}
    </div>
  );
}

function locationOrg() {
  return (
    document
      .querySelector('[data-testid="app-shell"]')
      ?.getAttribute('data-org-id') || ''
  );
}

export default function Root() {
  const tokenPath = location.pathname.startsWith('/invite/')
    ? location.pathname.split('/').pop()
    : null;

  return tokenPath ? (
    <Invite
      token={tokenPath}
      onDone={() => {
        window.location.href = '/';
      }}
    />
  ) : (
    <App />
  );
}