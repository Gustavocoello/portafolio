// src/sdk/hooks/useChatMessages.js
import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchChatMessages, getChatMessages } from '../core/chatApi'; // Cambiar esto el import
import { parseChatMessagesResponse } from '../utils/chatResponseParser';  // Cambiar esto el import
import { appendMessageToCache } from '../utils/chatCacheHelpers';

const OLDER_PAGE = 20; // mensajes viejos que se piden cada vez que se llega arriba
import chatMemoryCache from '../utils/chatMemoryCache'; // Cambiar esto el import 
import Logger from '../utils/logger';

const log = new Logger('useChatMessages');

export function useChatMessages(chatId, options = {}) {
  const {
    limit = 10,
    keep = 10,
    maxChats = 5,
    enabled = true,
    offlineMode = true,
    client,
  } = options;

  const queryClient = useQueryClient();
  const prevChatRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  const query = useInfiniteQuery({
    queryKey: ['chatMessages', chatId],
    queryFn: async ({ pageParam = null }) => {
      if (!chatId) return { messages: [], hasMore: false };

      // Intento de lectura de RAM
      if ((offlineMode && !pageParam) || (!pageParam && chatMemoryCache.get(chatId))) {
        const cached = chatMemoryCache.get(chatId);
        if (cached) {
          log.info(`[RAM] Cargando ${cached.length} mensajes para el chat: ${chatId}`);
          return { messages: cached, hasMore: false };
        }
      }

      log.info(`[API] Solicitando mensajes al backend/Redis para el chat: ${chatId}`);
      const rawData = await fetchChatMessages(client, chatId, limit, pageParam);
      return parseChatMessagesResponse(rawData, limit);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.messages[lastPage.messages.length - 1]?.id : undefined,
    enabled: enabled && !!chatId,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 5, // Cambio: gcTime en vez de cacheTime (nueva API)
  });

  const flatMessages = useMemo(
    () => query.data ? query.data.pages.flatMap(p => p.messages) : [],
    [query.data]
  );

  const lastUserMessageId = useMemo(() => {
    const userMsgs = flatMessages.filter(m => m.role === 'user');
    return userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].id : null;
  }, [flatMessages]);

  // GESTIÓN DE RAM
  // ============================================================
  useEffect(() => {
    if (!chatId || !flatMessages.length) return;
    const isStreaming = flatMessages.some(m => m.stable === false);
    if (isStreaming) {
      log.debug(`[RAM] Skipping save - mensaje en streaming`);
      return;
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const lastMsgs = flatMessages.slice(-keep);
      chatMemoryCache.set(chatId, lastMsgs);
      log.info(
        `[RAM] Snapshot: ${lastMsgs.length} guardados / ${flatMessages.length} totales en pantalla`
      );

      const allCachedChats = chatMemoryCache.keys();
      if (allCachedChats.length > maxChats) {
        const oldestChat = allCachedChats[0];
        chatMemoryCache.delete(oldestChat);
        log.warn(`[RAM] Eliminando chat antiguo: ${oldestChat}`);
      }
    }, 500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [chatId, flatMessages, keep, maxChats]);

  // Limpiar cache de React Query al cambiar de chat
  useEffect(() => {
    const prev = prevChatRef.current;
    if (prev && prev !== chatId) {
      queryClient.removeQueries({ queryKey: ['chatMessages', prev] });
      log.debug(`[QueryClient] Limpiando caché de React Query para chat previo: ${prev}`);
    }
    prevChatRef.current = chatId;
  }, [chatId, queryClient]);

  const patchMessageInCache = useCallback((messageId, updater, overrideId = null) => {
    const targetId = overrideId || chatId;
    if (!targetId) return;
    log.info(`[PATCH] Actualizando mensaje: ${messageId} en chat: ${targetId}`);
    
    queryClient.setQueryData(['chatMessages', targetId], old => {
      if (!old) {
        log.warn('[PATCH] No hay datos en cache para actualizar');
        return old;
      }
      
      const newData = {
        ...old,
        pages: old.pages.map(page => ({
          ...page,
          messages: page.messages.map(msg => {
            if (msg.id === messageId) {
              const updated = typeof updater === 'function' ? updater(msg) : updater;
              log.debug(`[PATCH] Mensaje actualizado:`, { old: msg, new: updated });
              return { ...msg, ...updated };
            }
            return msg;
          })
        }))
      };
      
      return newData;
    });
  }, [queryClient, chatId]);

  const appendMessages = useCallback((msgs, overrideId = null) => {
    const targetId = overrideId || chatId;
    if (!targetId) {
        log.error("No hay chatId para hacer APPEND");
        return;
    }
    log.info(`[APPEND] Añadiendo mensajes al chat: ${targetId}`);
    // Antes se recortaba a los últimos `keep`: los mensajes de arriba desaparecían y no se podía subir
    appendMessageToCache(queryClient, targetId, msgs);
  }, [queryClient, chatId]);

  // Mensajes más viejos que el primero en pantalla (al subir). Los ids temporales (texto) no están en la base.
  const [hasOlder, setHasOlder] = useState(true);
  const loadingOlderRef = useRef(false);
  useEffect(() => { setHasOlder(true); }, [chatId]);

  const loadOlder = useCallback(async () => {
    const firstId = flatMessages.find(m => Number.isInteger(m.id))?.id;
    if (!chatId || !client || !hasOlder || loadingOlderRef.current || firstId == null) return false;
    loadingOlderRef.current = true;
    try {
      const raw = await getChatMessages(client, chatId, { before: firstId, limit: OLDER_PAGE });
      const older = parseChatMessagesResponse(raw, OLDER_PAGE).messages;
      if (older.length < OLDER_PAGE) setHasOlder(false);
      if (!older.length) return false;
      queryClient.setQueryData(['chatMessages', chatId], old => old?.pages ? {
        ...old,
        pages: [{ ...old.pages[0], messages: [...older, ...old.pages[0].messages] }, ...old.pages.slice(1)],
      } : old);
      return true;
    } catch (e) {
      log.error(`[OLDER] No se pudieron cargar mensajes anteriores: ${e.message}`);
      return false;
    } finally {
      loadingOlderRef.current = false;
    }
  }, [chatId, client, hasOlder, flatMessages, queryClient]);

  return {
    ...query,
    messages: flatMessages,
    lastUserMessageId,
    isSuccess: query.isSuccess, 
    appendMessageToCache: appendMessages,
    updateMessageInCache: patchMessageInCache,
    loadOlder,
    hasOlder,
  };
}