import React, { useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
import { CgMoreAlt } from "react-icons/cg";
import { TbLayoutSidebar, TbMessagePlus } from "react-icons/tb";
import { FaCog } from 'react-icons/fa';

import { storageAdapter, USER_ID_KEY } from '../../../utils/storageAdapter';
import { useJarvis } from '../../../hooks/useJarvis';
import ChatMenu from '../ChatMenu/ChatMenu';
import Logger from '../../../utils/logger';
// Servicios
import { chatEvents } from '../../../core/events';
import { getAllChats, deleteChat } from '../../../core/chatApi';
import './Sidebar.css';

const log = new Logger('SidebarSDK');

const Sidebar = ({ 
  onNavigate,           // ← fn que el consumidor pasa para navegar
  currentPath = '',     // ← path actual para marcar activos
  settingsPath = '/settings',
  homePath = '/',
}) => {
  const [isOpen, setIsOpen] = useState(false); 
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const { isAuthenticated, isInitializing, client } = useJarvis();

  // --- Lógica de navegación dinámica ---
  // Función para generar la ruta base del usuario (ahora /chat/uuid)
  const navigateToPath = (subPath) => {
    // Obtenemos el ID justo antes de navegar
    const currentId = storageAdapter.getItem(USER_ID_KEY); 
    const basePath = currentId ? `/chat/${currentId}` : '/chat';
    
    // Si subPath ya empieza con '/', evitamos duplicar barras
    const cleanSubPath = subPath.startsWith('/') ? subPath : `/${subPath}`;
    const finalPath = `${basePath}${cleanSubPath}`;
    
    log.info(`[Sidebar] Navegando a: ${finalPath}`);
    onNavigate(finalPath);
  };
  
  // Cargar los chats desde localStorage
  const fetchAndSetChats = useCallback(async () => {
    if ( !client || !isAuthenticated) return;

    try {
      const fetchedChats = await getAllChats(client);
      log.info(" [Sidebar] CHATS RECIBIDOS DEL BACKEND:", fetchedChats);
      const chatsConTitulo = fetchedChats.map(chat => ({
        ...chat,
        title: chat.title && chat.title.trim() !== '' ? chat.title : 'Sin título',
        date: chat.updated_at || chat.created_at
      }));
      setChats(chatsConTitulo);
      const savedId = storageAdapter.getItem('activeChatId');
        if (savedId) {
          // Opcional: emitir evento para sincronizar ChatPage
          chatEvents.emit('chat-loaded', { chatId: savedId });
        }
    } catch (error) {
      log.error(' [Sidebar] Error cargando chats:', error);
    }
  }, [client, isAuthenticated]);

  useEffect(() => {
    chatEvents.emit('sidebar-toggled', { isOpen });
  }, [isOpen]);

  useEffect(() => {    
    if (isAuthenticated && !isInitializing && client) {
      fetchAndSetChats(); 
    }
  }, [isAuthenticated, isInitializing, client, fetchAndSetChats]);

  // Listener de chats-updated restaurado con !isInitializing
  useEffect(() => {
    const unsubscribe = chatEvents.on('chats-updated', () => {
      if (isAuthenticated && !isInitializing) {
        log.info('[Sidebar] Chats actualizados, recargando lista...');
        fetchAndSetChats();
      }
    });
    return () => unsubscribe();
  }, [isAuthenticated, isInitializing, fetchAndSetChats]);

  // Escuchar cambios externos en el chat activo
  useEffect(() => {
    const unsubscribe = chatEvents.on('chat-loaded', (data) => {
      setCurrentChatId(data.chatId);
    });

    return () => unsubscribe();
  }, []);

  function getChatGroup(chatDateStr) {
    const chatDate = dayjs(chatDateStr);
    const now = dayjs();
    const diffDays = now.diff(chatDate, 'day');

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return 'previous7Days';
    if (diffDays < 30) return 'previous30Days';
    return 'older';
  }

  const categorizedChats = chats.reduce((acc, chat) => {
    const group = getChatGroup(chat.date);
    acc[group].push(chat);
    return acc;
  }, {
    today: [],
    yesterday: [],
    previous7Days: [],
    previous30Days: [],
    older: []
  });

  // Borrar un chat
  const handleDeleteChat = async (chatId) => {
    try {
      await deleteChat(client, chatId);
      const updatedChats = chats.filter(chat => chat.id !== chatId);
      setChats(updatedChats);

      if (storageAdapter.getItem() === chatId) { //get.Item() para usar el adaptador antes estaba asi getItem('activeChatId')
        storageAdapter.removeItem();
      }

      if (currentChatId === chatId) {
        setCurrentChatId(null);
        chatEvents.emit('chat-loaded', { chatId: null });
      }
    } catch (error) {
      log.error(' [Sidebar] Error eliminando chat:', error);
    }
  };
  
  const [showMenu, setShowMenu] = useState(null);

  const toggleMenu = (chatId, event) => {
    if (event) {
      event.stopPropagation();
      
      if (showMenu !== chatId) {
        const rect = event.currentTarget.getBoundingClientRect();
        setMenuPosition({
          top: rect.bottom + window.scrollY,
          left: rect.right + window.scrollX,
        });
      }
    }

    setShowMenu(showMenu === chatId ? null : chatId);
  };

  // Cargar mensajes del chat seleccionado - Simplificamos el handleLoadChat
  const closeOnPhone = () => { if (window.innerWidth <= 768) setIsOpen(false); };

  const handleLoadChat = (chatId) => {
    setCurrentChatId(chatId);
    chatEvents.emit('chat-loaded', { chatId });
    closeOnPhone();
  };

  const handleNewChat = () => {
    chatEvents.emit('new-chat');
    closeOnPhone();
  };
  const isActive = (path) => currentPath === path;
  const groupLabels = { today: 'Today', yesterday: 'Yesterday', previous7Days: 'Previous 7 days', previous30Days: 'Previous 30 days', older: 'Older' };
  const hasChats = Object.values(categorizedChats).some((g) => g.length > 0);

  return (
    <>
      <button
        className="sidebar-toggle-floating"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Cerrar barra lateral' : 'Abrir barra lateral'}
        aria-expanded={isOpen}
      >
        <TbLayoutSidebar size={20} />
      </button>

      {!isOpen && (
        <button
          className={`sidebar-settings-floating ${isActive(settingsPath) ? 'active' : ''}`}
          onClick={() => navigateToPath(settingsPath)}
          aria-label="Configuración"
        >
          <FaCog size={18} />
        </button>
      )}

      <aside className={`sidebar ${isOpen ? 'open' : 'closed'}`} aria-hidden={!isOpen}>
        {isOpen && (
          <>
            <div className="sb-top">
              {isAuthenticated && (
                <button className="sb-new" onClick={handleNewChat}>
                  <TbMessagePlus size={18} />
                  <span>New chat</span>
                </button>
              )}
            </div>

            <nav className="sb-list" aria-label="Chats">
              {Object.entries(categorizedChats).map(([groupKey, groupChats]) =>
                groupChats.length > 0 && (
                  <section key={groupKey} className="sb-group">
                    <h3 className="sb-group-title">{groupLabels[groupKey]}</h3>
                    {groupChats.map((chat) => (
                      <div key={chat.id} className={`sb-chat ${chat.id === currentChatId ? 'active' : ''}`}>
                        <button className="sb-chat-title" onClick={() => handleLoadChat(chat.id)} title={chat.title}>
                          {chat.title}
                        </button>
                        <button
                          className="sb-chat-more"
                          onClick={(e) => { e.stopPropagation(); toggleMenu(chat.id, e); }}
                          aria-label={`Opciones de ${chat.title}`}
                        >
                          <CgMoreAlt size={16} />
                        </button>
                        {showMenu === chat.id && (
                          <ChatMenu
                            chatId={chat.id}
                            position={menuPosition}
                            onDelete={handleDeleteChat}
                            onClose={() => setShowMenu(null)}
                          />
                        )}
                      </div>
                    ))}
                  </section>
                )
              )}
              {!hasChats && (
                <p className="sb-empty">{isAuthenticated ? 'No chats yet.' : 'Sign in to save your chats.'}</p>
              )}
            </nav>

            {/* Pie como el de Claude: la marca a la izquierda (lleva al inicio) y la configuración a la derecha */}
            <div className="sidebar-footer">
              <button className="sidebar-brand" onClick={() => onNavigate(homePath)} title="Inicio">
                <img src="/arte/planeta.svg" alt="" className="sidebar-brand-logo art-dark" />
                <img src="/arte/planeta-light.svg" alt="" className="sidebar-brand-logo art-light" />
                <span>Jarvis</span>
              </button>
              <button
                className={`sidebar-footer-settings ${isActive(settingsPath) ? 'active' : ''}`}
                onClick={() => navigateToPath(settingsPath)}
                aria-label="Configuración"
                title="Configuración"
              >
                <FaCog size={17} />
              </button>
            </div>
          </>
        )}
      </aside>

      {isOpen && <div className="sidebar-overlay" onClick={() => setIsOpen(false)} />}
    </>
  );
};

export default Sidebar;