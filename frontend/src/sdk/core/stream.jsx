// src/sdk/core/stream.jsx
import { apiLogger } from '../utils/logger';

// Envía un mensaje al agente JARVIS y va entregando la respuesta
export const sendMessage = async (
  { chatId, text, hidden_context = '', tool = '' },
  onPartialResponse = null,
  signal,
  client,
  getToken,
  appId
) => {
  if (!client) throw new Error('[jarvis-sdk] sendMessage requiere un client');

  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const token = typeof getToken === 'function' ? await getToken() : null;
    const baseURL = client.defaults.baseURL;

    const headers = {
      'Content-Type': 'application/json',
      'X-Project-Origin': appId,
    };

    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${baseURL}/api/v2/chat/${chatId}/message`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ text, hidden_context, tool }),
      signal,
    });

    if (response.status === 401) {
      throw new Error('[jarvis-sdk] No autorizado. Verifica tu getToken.');
    }

    if (response.status === 403) {
      const detail = (await response.json().catch(() => ({}))).detail;
      throw new Error(detail?.error || 'Has alcanzado el límite de mensajes de prueba.');
    }

    if (!response.ok || !response.body) {
      throw new Error('[jarvis-sdk] No se pudo conectar al servidor');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      if (onPartialResponse) onPartialResponse(fullText);
    }

    return fullText;

  } catch (error) {
    if (error.name === 'AbortError') {
      apiLogger.info('[jarvis-sdk] Streaming abortado por el usuario');
      throw error;
    }
    throw new Error(`[jarvis-sdk] Error en streaming: ${error.message}`);
  }
};

export const sendAnonymousMessage = async (promptText, client) => {
  if (!client) throw new Error('[jarvis-sdk] sendAnonymousMessage requiere un client');
  try {
    const response = await client.post('/api/v1/search/prompt', { prompt: promptText });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.detail?.error || 'Error en mensaje anónimo');
  }
};

export const extractFileContent = async (
  file, 
  client, 
  getToken, 
  appId
  ) => {
  if (!client) throw new Error('[jarvis-sdk] extractFileContent requiere un client');

  const token = typeof getToken === 'function' ? await getToken() : null;
  const baseURL = client.defaults.baseURL;

  const formData = new FormData();
  formData.append('file', file);

  const headers = { 'X-Project-Origin': appId };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Sin Content-Type — el browser pone el boundary del FormData

  const response = await fetch(`${baseURL}/api/v1/chat/extract_file`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || '[jarvis-sdk] Error al extraer archivo');
  }

  return await response.json();
};