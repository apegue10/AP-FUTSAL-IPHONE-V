
/* AP FUTSAL - Sincronización compartida */
(() => {
  'use strict';

  const URL = 'https://hzcqbmrefjxpuchshgkr.supabase.co';
  const KEY = 'sb_publishable_-URM75mTiyLMbOh112uhgw_f-cM6LGF';

  const SESSION_KEY = 'ap-futsal-cloud-session-v1';
  const TEAM_KEY = 'ap-futsal-cloud-team-v1';
  const PENDING_KEY = 'AP_FUTSAL_CLOUD_PENDING';
  const STORAGE_KEY = 'futsal-bench-manager-v4';
  const TEMPLATE_KEY = 'ap-futsal-template-v1';

  let syncing = false;
  let refreshing = null;
  let timer = null;

  const session = () => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch (_) {
      return null;
    }
  };

  const team = () => {
    try {
      return JSON.parse(localStorage.getItem(TEAM_KEY) || 'null');
    } catch (_) {
      return null;
    }
  };

  const pending = () => {
    try {
      const value = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  };

  function setPending(ids) {
    localStorage.setItem(PENDING_KEY, JSON.stringify([...new Set(ids)]));
  }

  function status(id, message) {
    const el = document.getElementById(id);
    if (el) el.textContent = message;
  }

  function value(id) {
    return document.getElementById(id)?.value.trim() || '';
  }

  function requireSession() {
    const s = session();
    if (!s?.access_token || !s.user?.id) {
      throw new Error('Inicia sesión primero.');
    }
    return s;
  }

  async function refreshSession() {
    if (refreshing) return refreshing;

    refreshing = (async () => {
      const old = session();
      if (!old?.refresh_token) {
        throw new Error('La sesión ha caducado. Inicia sesión de nuevo.');
      }

      const response = await fetch(
        URL + '/auth/v1/token?grant_type=refresh_token',
        {
          method: 'POST',
          headers: {
            apikey: KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ refresh_token: old.refresh_token })
        }
      );

      const data = await response.json();
      if (!response.ok || !data.access_token) {
        throw new Error(data.message || 'No se pudo renovar la sesión.');
      }

      saveSession(data);
      return data;
    })();

    try {
      return await refreshing;
    } finally {
      refreshing = null;
    }
  }

  function saveSession(data) {
    const saved = {
      ...(session() || {}),
      ...data,
      expires_at: data.expires_at ||
        Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600)
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
    return saved;
  }

  async function api(path, options = {}) {
    let s = session();

    const authFlow =
      path.includes('grant_type=password') ||
      path.includes('grant_type=refresh_token') ||
      path.includes('/signup');

    if (!authFlow && s?.refresh_token &&
        Number(s.expires_at || 0) * 1000 < Date.now() + 60000) {
      s = await refreshSession();
    }

    async function send() {
      const response = await fetch(URL + path, {
        ...options,
        headers: {
          apikey: KEY,
          'Content-Type': 'application/json',
          ...(s?.access_token
            ? { Authorization: 'Bearer ' + s.access_token }
            : {}),
          ...(options.headers || {})
        }
      });

      const raw = await response.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch (_) {
        data = raw;
      }

      return { response, data };
    }

    let result = await send();

    if (result.response.status === 401 &&
        !authFlow && s?.refresh_token) {
      s = await refreshSession();
      result = await send();
    }

    if (!result.response.ok) {
      const d = result.data;
      throw new Error(
        d?.message || d?.details || d?.hint ||
        d?.error_description ||
        (typeof d === 'string' ? d : 'Error HTTP ' + result.response.status)
      );
    }

    return result.data;
  }

  function refreshStatus() {
    const s = session();
    const t = team();

    if (s?.user) {
      status('cloud-auth-status',
        'Sesión iniciada: ' + (s.user.email || 'cuenta'));
    } else {
      status('cloud-auth-status', 'Sin iniciar sesión.');
    }

    if (t?.id) {
      status('cloud-team-status',
        'Equipo seleccionado: ' + t.name + ' · Código: ' + t.invite_code);
    } else {
      status('cloud-team-status', 'Ningún equipo seleccionado.');
    }
  }

  async function cloudSignIn() {
    try {
      const email = value('cloud-email');
      const password = document.getElementById('cloud-password')?.value || '';

      if (!email || !password) {
        throw new Error('Escribe el correo y la contraseña.');
      }

      const data = await api('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      saveSession(data);
      refreshStatus();
      status('cloud-auth-status', 'Sesión iniciada: ' + email);
      await syncPending();
    } catch (e) {
      status('cloud-auth-status', 'Error al iniciar sesión: ' + e.message);
    }
  }

  async function cloudSignUp() {
    try {
      const email = value('cloud-email');
      const password = document.getElementById('cloud-password')?.value || '';

      if (!email || password.length < 6) {
        throw new Error('Escribe un correo y una contraseña de al menos 6 caracteres.');
      }

      const data = await api('/auth/v1/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      if (data?.access_token) {
        saveSession(data);
        status('cloud-auth-status', 'Cuenta creada: ' + email);
      } else {
        status('cloud-auth-status',
          'Cuenta creada. Confirma el correo y después inicia sesión.');
      }
      refreshStatus();
    } catch (e) {
      status('cloud-auth-status', 'Error al crear la cuenta: ' + e.message);
    }
  }

  async function cloudSignOut() {
    try {
      if (session()?.access_token) {
        await api('/auth/v1/logout', { method: 'POST' });
      }
    } catch (_) {}

    localStorage.removeItem(SESSION_KEY);
    refreshStatus();
    status('cloud-auth-status', 'Sesión cerrada. Los datos locales se conservan.');
  }

  async function loadTeam(id) {
    const rows = await api(
      '/rest/v1/teams?id=eq.' + encodeURIComponent(id) +
      '&select=id,name,invite_code'
    );

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('No se pudo recuperar el equipo.');
    }

    localStorage.setItem(TEAM_KEY, JSON.stringify(rows[0]));
    refreshStatus();
    return rows[0];
  }

  function returnedId(result) {
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) {
      return typeof result[0] === 'string'
        ? result[0]
        : result[0]?.id;
    }
    return result?.id;
  }

  async function cloudCreateTeam() {
    try {
      requireSession();
      const name = value('cloud-team-name');
      if (!name) throw new Error('Escribe el nombre del equipo.');

      const result = await api('/rest/v1/rpc/create_team', {
        method: 'POST',
        body: JSON.stringify({ team_name: name })
      });

      const id = returnedId(result);
      if (!id) throw new Error('No se recibió el identificador del equipo.');

      await loadTeam(id);
      status('cloud-team-status', 'Equipo creado correctamente.');
    } catch (e) {
      status('cloud-team-status', 'Error al crear el equipo: ' + e.message);
    }
  }

  async function cloudJoinTeam() {
    try {
      requireSession();
      const code = value('cloud-invite-code').toUpperCase();
      if (!code) throw new Error('Introduce el código de invitación.');

      const result = await api('/rest/v1/rpc/join_team', {
        method: 'POST',
        body: JSON.stringify({ invite_code_input: code })
      });

      const id = returnedId(result);
      if (!id) throw new Error('No se recibió el identificador del equipo.');

      await loadTeam(id);
      refreshStatus();
    } catch (e) {
      status('cloud-team-status', 'Error al unirte: ' + e.message);
    }
  }

  function localMatch(id) {
    return Array.isArray(S?.matchHistory)
      ? S.matchHistory.find(m => String(m.id) === String(id))
      : null;
  }

  async function uploadMatch(id) {
    const s = requireSession();
    const t = team();
    if (!t?.id) throw new Error('Selecciona o únete a un equipo primero.');

    const match = localMatch(id);
    const record = {
      team_id: t.id,
      match_id: String(id),
      payload: match || {},
      updated_by: s.user.id,
      updated_at: new Date().toISOString(),
      deleted: !match
    };

    await api(
      '/rest/v1/team_matches?on_conflict=team_id,match_id',
      {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(record)
      }
    );
  }

  async function uploadMetadata() {
    const s = requireSession();
    const t = team();
    if (!t?.id) throw new Error('Selecciona o únete a un equipo primero.');

    const existing = await api(
      '/rest/v1/team_app_data?team_id=eq.' +
      encodeURIComponent(t.id) + '&select=payload'
    );

    const oldPayload = Array.isArray(existing) && existing[0]?.payload
      ? existing[0].payload : {};

    const shared = {
      competitions: Array.isArray(S.competitions) ? S.competitions : [],
      teamName: S.teamName || '',
      template: {
        players: S.players.map(p => ({
          id: p.id,
          number: p.number,
          name: p.name,
          called: !!p.called
        }))
      }
    };

    await api('/rest/v1/team_app_data?on_conflict=team_id', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        team_id: t.id,
        payload: { ...oldPayload, shared },
        updated_by: s.user.id,
        updated_at: new Date().toISOString()
      })
    });
  }

  async function uploadAllMatches() {
    const ids = (S.matchHistory || []).map(m => m.id);
    for (const id of ids) await uploadMatch(id);

    for (const id of pending()) {
      if (!ids.some(x => String(x) === String(id))) {
        await uploadMatch(id);
      }
    }
  }

  async function cloudPush() {
    try {
      requireSession();
      if (!team()?.id) throw new Error('Selecciona o únete a un equipo primero.');

      if (!confirm(
        'Se compartirán los partidos y los datos de plantilla y competiciones con el equipo. ¿Continuar?'
      )) return;

      status('cloud-team-status', 'Subiendo partidos y datos del equipo…');

      await uploadAllMatches();
      await uploadMetadata();
      setPending([]);

      status('cloud-team-status', 'Datos subidos correctamente.');
    } catch (e) {
      status('cloud-team-status', 'Error al subir los datos: ' + e.message);
    }
  }

  async function cloudPull() {
    try {
      requireSession();
      const t = team();
      if (!t?.id) throw new Error('Selecciona o únete a un equipo primero.');

      if (pending().length) {
        throw new Error('Hay cambios pendientes. Súbelos antes de descargar.');
      }

      if (!confirm(
        'Se combinarán los partidos compartidos con los locales. Haz antes una copia de seguridad. ¿Continuar?'
      )) return;

      status('cloud-team-status', 'Descargando partidos del equipo…');

      const rows = await api(
        '/rest/v1/team_matches?team_id=eq.' +
        encodeURIComponent(t.id) +
        '&select=match_id,payload,updated_at,deleted'
      );

      const byId = new Map(
        (S.matchHistory || []).map(m => [String(m.id), m])
      );

      (rows || []).forEach(row => {
        const id = String(row.match_id);
        if (row.deleted) {
          byId.delete(id);
        } else if (row.payload && typeof row.payload === 'object') {
          byId.set(id, row.payload);
        }
      });

      S.matchHistory = Array.from(byId.values());

      const meta = await api(
        '/rest/v1/team_app_data?team_id=eq.' +
        encodeURIComponent(t.id) + '&select=payload'
      );

            // Compatibilidad con la sincronización Android anterior.
      const legacyPayload = meta?.[0]?.payload || {};
      const legacyState = legacyPayload.state;

      // Recuperar también los partidos guardados en el formato antiguo.
      if (Array.isArray(legacyState?.matchHistory)) {
        legacyState.matchHistory.forEach(match => {
          if (match && match.id != null && !byId.has(String(match.id))) {
            byId.set(String(match.id), match);
          }
        });
      }

      S.matchHistory = Array.from(byId.values());

      const shared = legacyPayload.shared || null;

      // Recuperar competiciones de cualquiera de los dos formatos.
      const competitions = [
        ...(Array.isArray(legacyState?.competitions) ? legacyState.competitions : []),
        ...(Array.isArray(shared?.competitions) ? shared.competitions : [])
      ];

      if (competitions.length) {
        S.competitions = [...new Set([
          ...(S.competitions || []),
          ...competitions
        ])];
      }

      if (shared?.teamName || legacyState?.teamName) {
        S.teamName = shared?.teamName || legacyState.teamName;
      }

      // Recuperar la plantilla, tanto del formato nuevo como del antiguo.
      const templateToUse = shared?.template || legacyPayload.template;

      if (Array.isArray(templateToUse?.players)) {
        localStorage.setItem(
          TEMPLATE_KEY,
          JSON.stringify(templateToUse)
        );

        templateToUse.players.forEach(tp => {
          const p = S.players.find(x => x.id === tp.id);

          if (p) {
            p.name = tp.name;
            p.number = tp.number;
            p.called = !!tp.called;
          } else {
            S.players.push({ ...tp });
          }
        });
      }

      save();
      if (typeof renderAll === 'function') renderAll();

      status('cloud-team-status', 'Datos descargados y combinados correctamente.');
    } catch (e) {
      status('cloud-team-status', 'Error al descargar: ' + e.message);
    }
  }

  async function syncPending() {
    if (syncing || !navigator.onLine || !pending().length) return;

    syncing = true;
    try {
      requireSession();
      if (!team()?.id) return;

      const batch = pending().slice();

      for (const id of batch) {
        await uploadMatch(id);
      }

      setPending(pending().filter(id => !batch.includes(id)));
      status('cloud-team-status', 'Cambios pendientes sincronizados.');
    } catch (e) {
      status('cloud-team-status',
        'Cambios guardados en este dispositivo. Pendiente de sincronizar: ' + e.message);
    } finally {
      syncing = false;
    }
  }

  function markPending(id) {
    if (id === undefined || id === null) return;

    const ids = pending();
    if (!ids.some(x => String(x) === String(id))) {
      ids.push(id);
      setPending(ids);
    }

    if (navigator.onLine) {
      clearTimeout(timer);
      timer = setTimeout(syncPending, 1200);
    } else {
      status('cloud-team-status',
        'Cambios guardados localmente. Se sincronizarán al recuperar Internet.');
    }
  }

  function wrapNewMatches(name) {
    const original = window[name];
    if (typeof original !== 'function' || original.__apCloudWrapped) return;

    const wrapped = function (...args) {
      const before = new Set(
        (S.matchHistory || []).map(m => String(m.id))
      );

      const result = original.apply(this, args);

      (S.matchHistory || []).forEach(m => {
        if (!before.has(String(m.id))) markPending(m.id);
      });

      return result;
    };

    wrapped.__apCloudWrapped = true;
    window[name] = wrapped;
  }

  function wrapHistoryClear() {
    const original = window.clearMatchHistory;
    if (typeof original !== 'function' || original.__apCloudWrapped) return;

    const wrapped = function (...args) {
      const before = (S.matchHistory || []).map(m => m.id);
      const result = original.apply(this, args);
      const after = new Set((S.matchHistory || []).map(m => String(m.id)));

      before.forEach(id => {
        if (!after.has(String(id))) markPending(id);
      });

      return result;
    };

    wrapped.__apCloudWrapped = true;
    window.clearMatchHistory = wrapped;
  }

  function installHooks() {
    wrapNewMatches('archiveCurrentMatch');
    wrapNewMatches('saveCurrentMatch');
    wrapHistoryClear();
  }

  window.cloudSignIn = cloudSignIn;
  window.cloudSignUp = cloudSignUp;
  window.cloudSignOut = cloudSignOut;
  window.cloudCreateTeam = cloudCreateTeam;
  window.cloudJoinTeam = cloudJoinTeam;
  window.cloudPush = cloudPush;
  window.cloudPull = cloudPull;
  window.cloudSyncPending = syncPending;

  window.addEventListener('online', syncPending);

  window.addEventListener('load', () => {
    refreshStatus();
    installHooks();
    syncPending();
  });

  if (document.readyState === 'complete') {
    refreshStatus();
    installHooks();
    syncPending();
  }
})();
        
