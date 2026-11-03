// src/sdk/hooks/useChatActions.jsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { chatEvents } from '../core/events';
import { streamLogger } from '../utils/logger';
import { sendMessage, sendAnonymousMessage } from '../core/stream';

export const useChatActions = (activeChatId, isAuthenticated, { appendMessageToCache, updateMessageInCache, md }, client, getToken, appId) => {
  const [isJarvisTyping, setIsJarvisTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [remaining, setRemaining] = useState(null); // mensajes gratis del visitante (null = sin dato)
  const abortControllerRef = useRef(null);

  // El visitante ve cuántos mensajes gratis le quedan desde que abre el chat, sin gastar uno
  useEffect(() => {
    if (isAuthenticated || !client) return;
    client.get('/api/v1/search/remaining')
      .then((r) => { if (typeof r.data?.remaining === 'number') setRemaining(r.data.remaining); })
      .catch(() => {});
  }, [isAuthenticated, client]);
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      setIsJarvisTyping(false);
    }
  }, []);

  const handleNewMessage = useCallback(async (message, contextFromFile = '', image = null, tool = '', overrideChatId = null, history = []) => {
    if (message.role !== 'user') return;
    
    const idToSend = overrideChatId || activeChatId;
    if (!idToSend || idToSend === 'null') {
        streamLogger.error("No se pudo determinar un Chat ID válido");
        return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsStreaming(true);
    setIsJarvisTyping(true);

    const userContent = message.content ?? message.text ?? '';
    const jarvisTempId = `jarvis-${Date.now()}`;
    const timestamp = Date.now();
    const userMessages = []
    if (image) {
      userMessages.push({
        id: `user-img-${timestamp}`,
        role: 'user',
        type: 'image',
        imageUrl: image, // El base64 para verla al instante
        content: userContent // Texto asociado
      });
    }

    // Lógica de contexto
    const combinedContext = Array.isArray(contextFromFile)
      ? contextFromFile.map(c => `🗂️ ${c.name}:\n${c.text}`).join('\n\n')
      : contextFromFile;

    const fullPrompt = combinedContext
      ? `Archivo recibido:\n${combinedContext}\n\nPregunta del usuario:\n${userContent}`
      : userContent;

    // Preparar UI (HTML)
    if (userContent || !image) {
      const escapeHtml = (text) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      userMessages.push({
        id: `user-txt-${timestamp}`,
        role: 'user',
        type: 'html',
        content: userContent,
        html: `<p>${escapeHtml(userContent)}</p>`
      });
    }

    // Inyectar en caché 
    appendMessageToCache(
      [
      ...userMessages,
      { id: jarvisTempId, role: 'assistant', content: '', html: '', stable: false }
      ],
      idToSend
    );

    try {
      let res;
      if (!isAuthenticated) {
        // --- FLUJO ANÓNIMO --- (el tope de mensajes lo lleva el servidor, por IP)
        res = await sendAnonymousMessage(fullPrompt, client, history);
        if (typeof res.remaining === 'number') setRemaining(res.remaining);

        const reply = res.result || res.error || "Sin respuesta";
        updateMessageInCache(jarvisTempId, { content: reply, html: md.render(reply), stable: true }, idToSend);

      } else {
        // --- FLUJO AUTENTICADO (Streaming) ---
        await sendMessage({
          chatId: idToSend,
          text: userContent,
          hidden_context: combinedContext,
          tool: tool
        }, (partial) => {
          let cleanPartial = partial;
          if (partial.includes('[NOTIFICATION]')) {
            const [text, note] = partial.split('[NOTIFICATION]');
            cleanPartial = text.trim();
            if (note) chatEvents.emit('show-notification', note.trim());
          }

          updateMessageInCache(jarvisTempId, {
            content: cleanPartial,
            html: md.render(cleanPartial),
            stable: false
          }, idToSend);
        }, controller.signal, 
          client,
          getToken,
          appId
        );

        updateMessageInCache(jarvisTempId, { stable: true }, idToSend);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        streamLogger.error(err);
        if (!isAuthenticated && err.status === 403) setRemaining(0);
        // El chat dibuja a partir de `content`: sin él, el error quedaba como una burbuja vacía
        const msg = (err.message || '').replace(/^\[jarvis-sdk\][^:]*:\s*/, '') || 'No se pudo conectar con Jarvis.';
        updateMessageInCache(jarvisTempId, { content: msg, html: md.render(msg), error: true, stable: true }, idToSend);
      }
    } finally {
      setIsJarvisTyping(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [activeChatId, isAuthenticated, appendMessageToCache, updateMessageInCache, md, client, getToken, appId]);

  return { handleNewMessage, isJarvisTyping, isStreaming, stopGeneration, remaining };
};