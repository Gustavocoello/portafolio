// src/sdk/hooks/useJarvis.js
import { useContext } from 'react';
import { JarvisContext } from '../context/JarvisProvider';
import { initiateGoogleCalendarOAuth } from '../core/auth-integrations';

export const useJarvis = () => {
  const context = useContext(JarvisContext);
  
  if (!context) {
    throw new Error("useJarvis debe usarse dentro de un JarvisProvider");
  }

  // 1. Extraemos TODO del contexto (incluyendo los nuevos estados del Provider)
  const { user, getToken, isAuthenticated, isInitializing, client, appId } = context;

  const connectGoogleCalendar = async () => {
    // Usamos las variables extraídas
    if (!user || !getToken) {
      throw new Error("Autenticación no disponible en el SDK");
    }
    return await initiateGoogleCalendarOAuth(getToken, user.id);
  };

  // 2. Devolvemos TODO para que el ChatContainer lo pueda usar
  return { 
    ...context, 
    connectGoogleCalendar 
  };
};