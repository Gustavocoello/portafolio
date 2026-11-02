// src/sdk/core/auth-integrations.js
import Logger from '../utils/logger';

const log = new Logger('AuthIntegrations');

/**
 * Lógica pura de conexión OAuth sin dependencia de Clerk.
 * Recibe el token y el user como parámetros.
 */
export const initiateGoogleCalendarOAuth = async (getToken, userId) => {
  const VITE_APP = import.meta.env.VITE_URL;
  const API_BASE = `${VITE_APP}/api/v1`;

  try {
    // 1. Obtener el token (llamamos a la función que nos pasen)
    const token = await getToken({ template: 'backend-api-jarvis' });
    
    if (!token) throw new Error("No auth token available");

    // 2. Llamada al backend
    const res = await fetch(`${API_BASE}/auth/google/login`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) throw new Error(`Backend failed: ${res.status}`);

    const data = await res.json();
    const authUrl = data.auth_url;

    if (!authUrl) throw new Error("Auth URL not received");

    // 3. Redirigir
    const finalUrl = `${authUrl}&userId=${userId}`;
    window.location.href = finalUrl;

  } catch (error) {
    log.error("Google OAuth error:", error);
    throw error;
  }
};