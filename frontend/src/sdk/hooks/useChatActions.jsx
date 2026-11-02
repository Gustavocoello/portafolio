// src/sdk/hooks/useChatActions.jsx
import { useState, useCallback, useRef } from 'react';
import { chatEvents } from '../core/events';
import { streamLogger } from '../utils/logger';
import { sendMessage, sendAnonymousMessage } from '../core/stream';

export const useChatActions = (activeChatId, isAuthenticated, { appendMessageToCache, updateMessageInCache, md }, client, getToken, appId) => {
  const [isJarvisTyping, setIsJarvisTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef(null);
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      setIsJarvisTyping(false);
    }
  }, []);

  const handleNewMessage = useCallback(async (message, contextFromFile = '', image = null, tool = '', overrideChatId = null) => {
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
    const escapeHtml = (text) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const htmlParts = [];
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
        // --- FLUJO ANÓNIMO ---
        const anonCount = parseInt(localStorage.getItem('anonMessageCount') || '0', 10);
        if (anonCount >= 5) {
          const limitMsg = "Has alcanzado el límite de 5 mensajes gratuitos. Por favor inicia sesión.";
          updateMessageInCache(jarvisTempId, { content: limitMsg, html: `<p>${limitMsg}</p>`, stable: true }, idToSend);
          setIsStreaming(false);
          setIsJarvisTyping(false);
          return;
        }

        res = await sendAnonymousMessage(fullPrompt, client);
        localStorage.setItem('anonMessageCount', String(anonCount + 1));
        
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
        updateMessageInCache(jarvisTempId, { stable: true, html: '<p style="color: red;">Error en la solicitud.</p>' }, idToSend);
      }
    } finally {
      setIsJarvisTyping(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [activeChatId, isAuthenticated, appendMessageToCache, updateMessageInCache, md, client, getToken, appId]);

  return { handleNewMessage, isJarvisTyping, isStreaming, stopGeneration };
};