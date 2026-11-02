import React, { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import { CgMoreAlt } from "react-icons/cg";
import { TbLayoutSidebar } from "react-icons/tb";
import { FaChartBar, FaCog } from 'react-icons/fa';

import { storageAdapter, USER_ID_KEY } from '../../../utils/storageAdapter';
import { useJarvis } from '../../../hooks/useJarvis';
import AnimatedJarvis from './utils/AnimatedJarvis';
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
  dashboardPath = '/dashboard',
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
  const fetchAndSetChats = async () => {
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
  };

  useEffect(() => {
    chatEvents.emit('sidebar-toggled', { isOpen });
  }, [isOpen]);

  useEffect(() => {    
    if (isAuthenticated && !isInitializing && client) {
      fetchAndSetChats(); 
    }
  }, [isAuthenticated, isInitializing, client]);

  // Listener de chats-updated restaurado con !isInitializing
  useEffect(() => {
    const unsubscribe = chatEvents.on('chats-updated', () => {
      if (isAuthenticated && !isInitializing) {
        log.info('[Sidebar] Chats actualizados, recargando lista...');
        fetchAndSetChats();
      }
    });
    return () => unsubscribe();
  }, [isAuthenticated, isInitializing]);

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
  const handleLoadChat = (chatId) => {
    setCurrentChatId(chatId);
    chatEvents.emit('chat-loaded', { chatId });
  };
  const isActive = (path) => currentPath === path;
  return (
    <>
      <div className="sidebar-toggle-floating" onClick={() => setIsOpen(!isOpen)}>
        <TbLayoutSidebar size={20} />
      </div>

      {!isOpen && (
        <button
          className={`sidebar-settings-floating ${isActive(settingsPath) ? 'active' : ''}`}
          onClick={() => navigateToPath(settingsPath)} // ← onNavigate
        >
          <FaCog size={20} />
        </button>
      )}

      <div className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
        {isOpen && (
          <div className="sidebar-upper">
            <button
              className={`sidebar-item jarvis ${isActive(homePath) ? 'active' : ''}`}
              onClick={() => onNavigate(homePath)} // ← onNavigate
            >
              <div className="jarvis-logo">
                <AnimatedJarvis />
              </div>
            </button>

            <button
              className={`sidebar-item ${isActive(dashboardPath) ? 'active' : ''}`}
              onClick={() => onNavigate(dashboardPath)} // ← onNavigate
            >
              <FaChartBar className="icon" />
              <span className="label">Dashboard</span>
            </button>
          </div>
        )}

        {isOpen && (
          <div className="sidebar-section">
            <div className="chats-scroll">
              <ul className="chats-list">
                {Object.entries(categorizedChats).map(([groupKey, groupChats]) =>
                  groupChats.length > 0 && (
                    <li key={groupKey}>
                      <span className="chat-category">
                        {{ today: 'Today', yesterday: 'Yesterday', previous7Days: 'Previous 7 days', previous30Days: 'Previous 30 days', older: 'Older' }[groupKey]}
                      </span>
                      {groupChats.map((chat) => (
                        <div key={chat.id} className="chat-item-container">
                          <button
                            className={`sidebar-chat-item ${chat.id === currentChatId ? 'active' : ''}`}
                            onClick={() => handleLoadChat(chat.id)}
                          >
                            <span className="label">{chat.title}</span>
                          </button>
                          {chat.id === currentChatId && (
                            <button className="more-button" onClick={(e) => { e.stopPropagation(); toggleMenu(chat.id, e); }}>
                              <CgMoreAlt size={18} />
                            </button>
                          )}
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
                    </li>
                  )
                )}
                {Object.values(categorizedChats).every(g => g.length === 0) && (
                  <li><span className="no-chats-message">No hay chats guardados</span></li>
                )}
              </ul>
            </div>
          </div>
        )}

        {isOpen && (
          <button
            className={`sidebar-item sidebar-settings ${isActive(settingsPath) ? 'active' : ''}`}
            onClick={() => {
              if (typeof onNavigate === 'function') {
                onNavigate(`${getUserChatPath()}${settingsPath}`);
              } else {
                console.error("onNavigate no está definida en el Sidebar");
              }
            }} // ← onNavigate
          >
            <FaCog className="icon" />
            <span className="label">Settings</span>
          </button>
        )}
      </div>

      {isOpen && <div className="sidebar-overlay" onClick={() => setIsOpen(false)} />}
    </>
  );
};

export default Sidebar;