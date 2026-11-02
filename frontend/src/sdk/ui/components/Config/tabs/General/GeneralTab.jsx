import React from 'react';
import { FaUserAstronaut } from 'react-icons/fa';
import { useJarvis } from '../../../../../hooks/useJarvis'; 
import './GeneralTab.css';

const GeneralTab = () => {
  // Sacamos todo lo necesario del hook
  const { user, logout, isInitializing, isAuthenticated } = useJarvis();

  // DEBUG: Vamos a ver qué hay dentro de user cuando isAuthenticated es true
  console.log("DEBUG GeneralTab:", { isAuthenticated, isInitializing, user });

  // 1. Si el SDK está arrancando, esperamos
  if (isInitializing) {
    return (
      <div className="tab-loading">
        <p>Iniciando sistemas de Jarvis...</p>
      </div>
    );
  }

  // 2. Si NO hay usuario y NO está inicializando, comprobamos la sesión
  // Si isAuthenticated es true pero no hay user, mostramos un mensaje de "Sincronizando"
  if (isAuthenticated && !user) {
    return (
      <div className="tab-loading">
        <p>Sincronizando perfil con la base de datos...</p>
      </div>
    );
  }

  // 3. Caso de error real: No autenticado
  if (!isAuthenticated) {
    return (
      <div className="error-state">
        <p>⚠️ Debes iniciar sesión para acceder a esta configuración.</p>
        <button className="logout-btn" onClick={() => window.location.href = '/login'}>
           Ir al Login
        </button>
      </div>
    );
  }

  // 4. Si llegamos aquí, isAuthenticated es true y user existe
  return (
    <div className="general-tab-container">
      <h3>Información General</h3>

      <div className="profile-section">
        <div className="user-info-left">
          {/* Usamos encadenamiento opcional (?.) para evitar crasheos si el objeto viene raro */}
          <p><strong>Nombre:</strong> {user?.fullName || user?.username || "Usuario"}</p>
          <p><strong>Email:</strong> {user?.primaryEmail || user?.email || "Sin email"}</p>
          <p><strong>ID de Base de Datos:</strong> {user?.id || 'Generando...'}</p>
          
          <div className="logout-button-wrapper">
            <button className="logout-btn" onClick={logout}>
              Cerrar Sesión
            </button>
          </div>
        </div>

        <div className="avatar-right">
          {user?.imageUrl ? (
            <img src={user.imageUrl} alt="Avatar" className="avatar" />
          ) : (
            <div className="fallback-icon">
              <FaUserAstronaut />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GeneralTab;