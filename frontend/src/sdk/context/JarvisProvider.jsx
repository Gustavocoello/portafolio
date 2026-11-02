// src/sdk/context/JarvisProvider.jsx
import React, { createContext, useContext, useMemo, useEffect, useState } from 'react';
import { createChatClient } from '../core/client';
import { streamLogger } from '../utils/logger';

export const JarvisContext = createContext(null);

export const JarvisProvider = ({ children, config = {} }) => {
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const { baseURL, getToken, appId, theme, logout } = config;
  
  const client = useMemo(() => {
    streamLogger.info('[jarvis-sdk] - JarvisProvider: Creando cliente con AppID:', appId);
    return createChatClient({
      baseURL,
      getToken,
      appId: appId, 
    });
  }, [baseURL, getToken, appId]);

  useEffect(() => {
    const init = async () => {
      if (!getToken) {
        setIsInitializing(false);
        return;
      }
      try {
        const token = await getToken();
        streamLogger.info('[jarvis-sdk] - JarvisProvider: init con baseURL:', baseURL);
        streamLogger.info('[jarvis-sdk] - JarvisProvider: getToken existe:', !!getToken);
        if (token) {
          setIsAuthenticated(true);
          try {
            streamLogger.info('[jarvis-sdk] Pidiendo perfil con AppID:', appId);
            const response = await client.get('/api/v1/user/profile');
            const userData = response.data?.user || response.data;
            setUser(userData);
            streamLogger.info('✅ SDK User cargado:', userData);
          } catch (syncError) {
            streamLogger.error('Error cargando perfil:', syncError);
          }
        }
      } catch (e) {
        streamLogger.error('Error obteniendo token:', e);
      } finally {
        setIsInitializing(false);
      }
    };

    init();
  }, [client, getToken, appId]);

  const value = useMemo(() => ({
    version: '2026.1.0',
    client,
    appId,
    getToken: config.getToken,
    isAuthenticated,
    isInitializing,
    user,
    logout: config.logout || (() => {
      console.warn('[jarvis-sdk] logout llamado sin handler configurado');
    }),
  }), [client, appId, config.getToken, isAuthenticated, isInitializing, user, config.logout]);

  return (
    <JarvisContext.Provider value={value}>
      <div className="jarvis-sdk-container" data-theme={config.theme || 'dark'}>
        {children}
      </div>
    </JarvisContext.Provider>
  );
};

export const useJarvis = () => {
  const context = useContext(JarvisContext);
  if (!context) throw new Error('useJarvis debe usarse dentro de JarvisProvider');
  return context;
};

