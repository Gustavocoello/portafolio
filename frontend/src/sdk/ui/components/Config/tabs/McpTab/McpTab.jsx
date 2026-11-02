// src/sdk/components/config/tabs/McpTab/McpTab.jsx
// Conexiones: las herramientas que Jarvis usa de verdad y su estado real (GET /api/v1/integrations/status).
import React, { useState, useEffect } from 'react';

import { useJarvis } from '../../../../../hooks/useJarvis';
import Logger from '../../../../../utils/logger';

import { FcGoogle } from 'react-icons/fc';
import { SiNotion } from 'react-icons/si';
import { FaGithub } from 'react-icons/fa';
import { TbMail, TbWorldSearch, TbFileText } from 'react-icons/tb';

import './McpTab.css';

const log = new Logger('McpTab');

// `kind`: "user" se conecta desde aquí; "server" usa credenciales del servidor; "builtin" siempre está.
const SERVICES = [
  { id: 'email', kind: 'server', icon: <TbMail />, name: 'Correo', description: 'Lee y resume los correos de tu buzón de Previseguros.' },
  { id: 'google_calendar', kind: 'user', icon: <FcGoogle />, name: 'Google Calendar', description: 'Consulta tu agenda y crea eventos.' },
  { id: 'notion', kind: 'server', icon: <SiNotion />, name: 'Notion', description: 'Busca y lee páginas y bases de datos.' },
  { id: 'github', kind: 'server', icon: <FaGithub />, name: 'GitHub', description: 'Revisa repositorios, issues y pull requests.' },
  { id: 'search', kind: 'builtin', icon: <TbWorldSearch />, name: 'Búsqueda web', description: 'Busca en internet cuando hace falta información actual.' },
  { id: 'documents', kind: 'builtin', icon: <TbFileText />, name: 'Documentos', description: 'Responde sobre los archivos que adjuntas en el chat.' },
];

const McpTab = () => {
  const { client, connectGoogleCalendar, isAuthenticated } = useJarvis();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(null);

  const loadStatus = async () => {
    try {
      const response = await client.get('/api/v1/integrations/status');
      setStatus(response.data);
      setError(false);
    } catch (e) {
      log.error('Error leyendo el estado de las conexiones:', e);
      setError(true);
    }
  };

  useEffect(() => {
    if (isAuthenticated) loadStatus();
    const params = new URLSearchParams(window.location.search);
    if (params.get('connection_success') || params.get('error')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- al montar y cuando la sesión termina de cargar
  }, [isAuthenticated]);

  const connect = async () => {
    setBusy('google_calendar');
    try {
      await connectGoogleCalendar(); // redirige a Google
    } catch (e) {
      log.error('Error conectando Google Calendar:', e);
      setBusy(null);
    }
  };

  const disconnect = async (id) => {
    setBusy(id);
    try {
      await client.post(`/api/v1/integrations/disconnect/${id}`);
      await loadStatus();
    } catch (e) {
      log.error(`Error desconectando ${id}:`, e);
    } finally {
      setBusy(null);
    }
  };

  const stateOf = (service) => {
    if (service.kind === 'builtin') return { on: true, label: 'Siempre activa' };
    if (!status) return { on: false, label: isAuthenticated ? '…' : '—' };
    if (service.kind === 'server') return status[service.id] ? { on: true, label: 'Configurado' } : { on: false, label: 'Sin configurar' };
    return status[service.id] ? { on: true, label: 'Conectado' } : { on: false, label: 'Sin conectar' };
  };

  return (
    <div className="cx">
      <header className="cx-head">
        <h3>Conexiones</h3>
        <p>Las herramientas que Jarvis y TARS pueden usar por ti.</p>
      </header>

      {!isAuthenticated && <p className="cx-note">Inicia sesión para ver el estado de cada conexión.</p>}
      {error && <p className="cx-note cx-note-error">No se pudo leer el estado. Revisa tu sesión e inténtalo otra vez.</p>}
      {status && !status.owner && (
        <p className="cx-note">Estas herramientas usan las cuentas del dueño del sitio, así que solo él puede usarlas. Tú puedes conversar con Jarvis sin ellas.</p>
      )}

      <ul className="cx-list">
        {SERVICES.map((s) => {
          const st = stateOf(s);
          return (
            <li key={s.id} className="cx-item">
              <span className="cx-icon" aria-hidden="true">{s.icon}</span>
              <div className="cx-text">
                <span className="cx-name">{s.name}</span>
                <span className="cx-desc">{s.description}</span>
              </div>
              <span className={`cx-pill ${st.on ? 'on' : ''}`}>{st.label}</span>
              {s.kind === 'user' && status?.owner && (
                st.on ? (
                  <button className="cx-btn ghost" onClick={() => disconnect(s.id)} disabled={busy === s.id}>
                    {busy === s.id ? 'Desconectando…' : 'Desconectar'}
                  </button>
                ) : (
                  <button className="cx-btn" onClick={connect} disabled={busy === s.id}>
                    {busy === s.id ? 'Abriendo Google…' : 'Conectar'}
                  </button>
                )
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default McpTab;
