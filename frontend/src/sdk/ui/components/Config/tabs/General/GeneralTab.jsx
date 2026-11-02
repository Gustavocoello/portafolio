import React from 'react';
import { FaUserAstronaut } from 'react-icons/fa';
import { useJarvis } from '../../../../../hooks/useJarvis';
import './GeneralTab.css';

const GeneralTab = () => {
  const { user, logout, isInitializing, isAuthenticated } = useJarvis();

  if (isInitializing) return <p className="gt-state">Iniciando Jarvis…</p>;

  if (!isAuthenticated) {
    return (
      <div className="gt-card gt-signin">
        <div>
          <p className="gt-name">No has iniciado sesión</p>
          <p className="gt-mail">Inicia sesión para guardar tus chats y ver tus conexiones.</p>
        </div>
        <button className="gt-btn primary" onClick={() => { window.location.href = '/login'; }}>Iniciar sesión</button>
      </div>
    );
  }

  if (!user) return <p className="gt-state">Sincronizando tu perfil…</p>;

  return (
    <div className="gt">
      <div className="gt-card">
        {user.imageUrl ? (
          <img src={user.imageUrl} alt="" className="gt-avatar" />
        ) : (
          <span className="gt-avatar gt-avatar-fallback" aria-hidden="true"><FaUserAstronaut /></span>
        )}
        <div className="gt-text">
          <p className="gt-name">{user.fullName || user.username || 'Usuario'}</p>
          <p className="gt-mail">{user.primaryEmail || user.email || 'Sin correo'}</p>
        </div>
        <button className="gt-btn danger" onClick={logout}>Cerrar sesión</button>
      </div>
    </div>
  );
};

export default GeneralTab;
