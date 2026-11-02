// src/features/chat/ChatPage.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import MarkdownIt from 'markdown-it';
import { TbMessagePlus } from "react-icons/tb";
import jarvisLogo from '../../../assets/icons/jarvis00.png';

// Componentes 
import SearchBar from '../SearchBar/SearchBar';
import MessageList from '../MessageList/MessageList';

// Hooks maestros del SDK
import { useJarvis } from '../../../hooks/useJarvis';
import { useChatUI } from '../../../hooks/useChatUI';
import { useChatState } from '../../../hooks/useChatState';
import { useChatActions } from '../../../hooks/useChatActions';
import { useChatMessages } from '../../../hooks/useChatMessages';

// Core y utils
import { getAllChats, createChat, updateChatTitle } from '../../../core/chatApi';
import { chatEvents } from '../../../core/events';
import { storageAdapter } from '../../../utils/storageAdapter';
import { streamLogger } from '../../../utils/logger';


const md = new MarkdownIt({ html: false, linkify: true });

// --- 1. NUEVO COMPONENTE INTERNO (Contiene toda la lógica de Hooks) ---
const ChatContent = ({ guest, isAuthenticated, onUnauthorized }) => {
  // Mueve TODOS los hooks aquí. Ahora se ejecutarán siempre en orden.
  const { 
    client,
    appId,
    getToken,
    isInitializing
  } = useJarvis();

  const {
    activeChatId,
    setActiveChatId,
    localMessages,
    setLocalMessages,
    hasSentMessage,
    setHasSentMessage
  } = useChatState();

  const { 
    messages: cachedMessages, 
    appendMessageToCache, 
    updateMessageInCache, 
    lastUserMessageId, 
    isSuccess 
  } = useChatMessages(activeChatId, { keep: 10 , client });

  const { 
    handleNewMessage, 
    isJarvisTyping, 
    isStreaming, 
    stopGeneration 
  } = useChatActions(activeChatId, isAuthenticated, { appendMessageToCache, updateMessageInCache, md }, client, getToken, appId);

  const {
    notification,
    pendingContext,
    setPendingContext,
    chatBottomRef,
    scrollToBottom
  } = useChatUI(isSuccess, lastUserMessageId, activeChatId);

  // --- COPIA AQUÍ TODOS TUS USEEFFECTS (initChat, sincronizar caché, etc.) ---
  useEffect(() => {
    const initChat = async () => {
      if (!isAuthenticated) return;
      try {
        const allChats = await getAllChats(client);
        if (!allChats || allChats.length === 0) return;
        const savedChatId = storageAdapter.getItem();
        const chatToLoad = allChats.find(c => c.id === savedChatId) || allChats[0];
        if (chatToLoad) setActiveChatId(chatToLoad.id);        
      } catch (e) { 
        streamLogger.error("Error al cargar chats iniciales:", e.message); 
      }
    };
    if (isAuthenticated && !isInitializing) initChat();
  }, [isAuthenticated, setActiveChatId]);

  // (Sigue pegando aquí el resto de useEffects: el 2, 3, 4, 5 y 6 que tenías)
  useEffect(() => {
    if (!cachedMessages || cachedMessages.length === 0) return;
    const formatted = cachedMessages.map(m => {
      if (m.role === 'assistant') return { ...m, html: m.content ? md.render(m.content) : '<span class="typing-dots">...</span>' };
      const safe = (m.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      return { ...m, html: `<p>${safe}</p>` };
    });
    setLocalMessages(formatted);
    if (!hasSentMessage && formatted.length > 0) {
      setHasSentMessage(true);
      chatEvents.emit('chats-updated');
    }
  }, [cachedMessages, hasSentMessage]);
  // 3. Escuchar Sidebar 
  useEffect(() => {
    const unsubscribe = chatEvents.on('chat-loaded', (data) => { if (data?.chatId) setActiveChatId(data.chatId); });
    return () => unsubscribe();
  }, []);

  // 4. Limpieza de anónimos 
  useEffect(() => { 
    if (isAuthenticated) localStorage.removeItem('anonMessageCount'); 
  }, [isAuthenticated]);

   // 5. Persistencia ID (Punto 5)
  useEffect(() => { 
    if (activeChatId) storageAdapter.setItem(activeChatId); 
  }, [activeChatId]);
  
  // 6. Si el ID cambia a null (nuevo chat), limpiamos la pantalla
  useEffect(() => { 
    if (!activeChatId) setLocalMessages([]); 
  }, [activeChatId]);

  const createNewChat = async () => {
    try {
      const newChat = await createChat(client, { title: "Nuevo Chat" });
      setActiveChatId(newChat.id);
      setLocalMessages([]);
      setHasSentMessage(false);
      storageAdapter.setItem(newChat.id);
      chatEvents.emit('chats-updated', { chatId: newChat.id });
    } catch (error) { streamLogger.error("Error creando nuevo chat:", error); }
  };

  // RENDERIZADO DEL CHAT
  return (
    <div className="jarvis-sdk-chat-wrapper">
      {isAuthenticated && (
        <button className="new-chat-button" onClick={createNewChat}>
          <TbMessagePlus size={23} />
        </button>
      )}
      <div className="content-area">
        <div className="jarvis-header">
          <img src={jarvisLogo} alt="Jarvis" className="jarvis-logo1" />
          <h1 className="jarvis-title">Hi, I'm Jarvis.</h1>
        </div>
        <h4>How can I help you today?</h4>
        <MessageList messages={localMessages} />
        <div ref={chatBottomRef} />
        {isJarvisTyping && <div className="typing-indicator">Jarvis está escribiendo...</div>}
      </div>

      <SearchBar
        client={client}
        getToken={getToken}
        appId={appId}
        onSearch={async (query, context, img, tool) => {
           let currentChatId = activeChatId;

          // 1. SI NO HAY CHAT ACTIVO, LO CREAMOS PRIMERO
          if (!currentChatId || currentChatId === 'null') {
            // CASO A: USUARIO AUTENTICADO (ID REAL - LLAMA A createChat del Backend)
            if (isAuthenticated) {
              try {
                streamLogger.info("Creando chat en DB para usuario autenticado...");
                const newChat = await createChat(client, { title: query.trim().substring(0, 30) });
                currentChatId = newChat.id;
                chatEvents.emit('chats-updated', { chatId: currentChatId });
              } catch (error) {
                streamLogger.error("Error al crear chat en DB", error);
                return;
              }
            } 
            // CASO B: INVITADO (ID Temporal - NO llama a createChat de Clerk)
            else {
              streamLogger.info("Generando ID temporal para invitado...");
              currentChatId = `guest_${Date.now()}`; // Generamos un ID local
              // No emitimos chats-updated porque no hay backend que refrescar
            }
            setActiveChatId(currentChatId);
            storageAdapter.setItem(currentChatId);
          }
          // El chat existe (se creó con el botón +) pero no tiene nombre real
          else if (isAuthenticated && !hasSentMessage) {
            try {
              await updateChatTitle(client, currentChatId, query.substring(0, 30));
              chatEvents.emit('chats-updated', { chatId: currentChatId });
              setHasSentMessage(true); // Para que no vuelva a intentar renombrar
            } catch (err) {
              console.error("No se pudo actualizar el título", err);
            }
          }
          // 3. Enviamos el mensaje normalmente
          handleNewMessage({ role: 'user', text: query }, context, img, tool, currentChatId);
        }}
        onContextExtracted={(entry) => setPendingContext(prev => [...prev, entry])}
        onClearContext={() => setPendingContext([])}
        onRemoveContext={(name) => setPendingContext(prev => prev.filter(c => c.name !== name))}
        pendingContext={pendingContext}
        showIcon={hasSentMessage}
        isStreaming={isStreaming}
        onStop={stopGeneration}
        onScrollToBottom={scrollToBottom}
      />
      {notification && <div className="notification-memory">{notification}</div>}
    </div>
  );
};

// --- 2. COMPONENTE PRINCIPAL (Solo controla el flujo de entrada) ---
const ChatContainer = ({ 
  guest = false, 
  onUnauthorized = () => console.warn("Login required"),
  renderLogo = null,
}) => {
  const { isAuthenticated, isInitializing } = useJarvis();

  // A. Mientras inicializa, no renderizamos nada (o un spinner)
  if (isInitializing) return null; 

  // B. Si terminó y no hay auth, disparamos el callback y bloqueamos
  if (!isAuthenticated && !guest) {
    onUnauthorized();
    return null; 
  }

  // C. Si todo está OK, renderizamos el contenido real
  return <ChatContent guest={guest} isAuthenticated={isAuthenticated} onUnauthorized={onUnauthorized} />;
};

export default ChatContainer;