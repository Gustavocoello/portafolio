///features/chat/components/Messagelist.jsx
import React, { useEffect, useCallback, useRef, useState } from 'react';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import CodeBlock from '../CodeBlock/CodeBlock';
import MarkdownRenderer from '../../../utils/MarkdownRenderer';
// Icons 
import { LuCopy } from "react-icons/lu";
import { FaArrowTurnDown, FaArrowTurnUp } from "react-icons/fa6";
import { LiaThumbtackSolid } from "react-icons/lia";

import { 
  HiOutlineThumbUp, HiOutlineThumbDown, HiOutlineShare, 
  HiOutlineDocumentDownload, HiOutlineDotsVertical 
} from "react-icons/hi";
import { VscRefresh } from "react-icons/vsc";
import './MessageList.css';

const AssistantActions = ({ content }) => {
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  // --- Lógica para cerrar al hacer clic fuera ---
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  return (
    <div className="assistant-actions-toolbar">
      {/* Botones principales */}
      <button className="toolbar-btn" title="Me gusta"><HiOutlineThumbUp size={18} /></button>
      <button className="toolbar-btn" title="No me gusta"><HiOutlineThumbDown size={18} /></button>
      <button className="toolbar-btn" title="Rehacer"><VscRefresh size={18} /></button>
      <button className="toolbar-btn" onClick={handleCopy} title="Copiar">
        <LuCopy size={16} color={copied ? "#4ade80" : "inherit"} />
      </button>

      {/* Menú de 3 puntos */}
      <div className="toolbar-menu-wrapper" ref={menuRef}>
        <button className="toolbar-btn" onClick={() => setShowMenu(!showMenu)}>
          <HiOutlineDotsVertical size={18} />
        </button>
        
        {showMenu && (
          <div className="toolbar-dropdown-menu">
            <button className="assistant-menu-item"><HiOutlineShare size={14} /> Compartir</button>
            <button className="assistant-menu-item"><HiOutlineDocumentDownload size={14} /> Exportar</button>
          </div>
        )}
      </div>
    </div>
  );
};

// Función para destacar búsqueda en texto
const highlightSearchTerm = (text, searchTerm) => {
  if (!searchTerm || searchTerm.trim() === '') return text;
  
  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
};

const UserMessageWrapper = ({ content, children, isHighlighted, searchTerm }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePin = () => {
    setIsPinned(!isPinned);
    // Aquí puedes agregar lógica para fijar el mensaje
  };

  const lines = content.split('\n');
  const needsCollapse = lines.length > 10;

  return (
    <div className={`user-message-container ${isExpanded ? 'expanded' : 'collapsed'} ${isHighlighted ? 'highlighted-message' : ''}`}>
      
      <div className="message-bubble user-bubble-relative">
        
        {/* BARRA DE ACCIONES FLOTANTE (Centrada en el borde superior) */}
        <div className="user-message-floating-bar">
          
          {/* Botón Copiar (Siempre visible) */}
          <button className="action-item" onClick={handleCopy} title="Copy">
            <LuCopy size={14} color={copied ? "#4ade80" : "inherit"} />
          </button>

          {/* Botón Fijar (Siempre visible) */}
          <button className={`action-item ${isPinned ? 'pinned' : ''}`} onClick={handlePin} title="Pin">
            <LiaThumbtackSolid size={15} />
          </button>

          {/* Botón Expandir (Condicional al texto) */}
          {needsCollapse && (
            <button className="action-item expand-btn" onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? <FaArrowTurnUp size={14} /> : <FaArrowTurnDown size={14} />}
            </button>
          )}
        </div>

        {/* Contenido del mensaje */}
        <div className="user-content-body">
          {children}
        </div>
      </div>
    </div>
  );
};

const MessageList = ({ messages = [], onLoadMore, hasMore, searchTerm = '' }) => {
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);
  const loadingRef = useRef(false);

  // Auto-scroll al final
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Detectar scroll arriba
  const handleScroll = useCallback(() => {
    if (!containerRef.current || loadingRef.current || !hasMore) return;

    const { scrollTop } = containerRef.current;
    
    if (scrollTop < 100) {
      loadingRef.current = true;
      onLoadMore?.();
      setTimeout(() => {
        loadingRef.current = false;
      }, 1000);
    }
  }, [hasMore, onLoadMore]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const filteredMessages = messages
    .filter(msg => !msg.html?.includes('[NOTIFICATION]'))
    .map(msg => ({
      ...msg,
      // Si tiene ID, es un mensaje guardado, por lo tanto es estable
      stable: msg.id ? true : msg.stable 
    }));

  // Manejo de errores mejorado
  const renderContent = (msg, keyPrefix) => {
    try {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = msg.html;

      return Array.from(tempDiv.childNodes).map((node, i) => {
        const key = `${keyPrefix}-${i}`;

        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'PRE') {
          const codeEl = node.querySelector('code');
          if (!codeEl) {
            return (
              <div
                key={key}
                className="message-html"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(node.outerHTML || '') }}
              />
            );
          }

          const content = codeEl.textContent.trim();
          const isProbablyInline = content.length < 30 && !content.includes('\n');
          if (isProbablyInline) {
            return <code key={key} className="inline-fix">{content}</code>;
          }

          const langClass = codeEl.getAttribute('class') || '';
          let language = langClass.replace('language-', '') || 'plaintext';

          if (!hljs.getLanguage(language)) language = 'plaintext';

          const highlighted = msg.stable
            ? content
            : hljs.highlight(content, { language }).value;

          return (
            <CodeBlock
              key={key}
              code={highlighted}
              language={language}
              isHtml={!msg.stable}
              stable={msg.stable ?? true}
            />
          );
        }

        return (
          <div
            key={key}
            className="message-html"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(node.outerHTML || '') }}
          />
        );
      });
    } catch (error) {
      console.error('Error rendering message content:', error);
      return (
        <div key={`${keyPrefix}-error`} className="message-error">
          No se pudo procesar el contenido del mensaje
        </div>
      );
    }
  };

  return (
    <div className="message-list-wrapper" ref={containerRef}>
      {hasMore && <div className="load-more-indicator">Scroll arriba para cargar...</div>}
      
      <div className="message-list">
        {filteredMessages.map((msg, index) => {
          const isHighlighted = searchTerm && msg.content?.toLowerCase().includes(searchTerm.toLowerCase());

          return (
            <div 
              key={msg.id || index} 
              id={`msg-${msg.id}`}
              className={`message ${msg.role} ${isHighlighted ? 'message-highlighted' : ''}`}
            >
              {msg.type === 'image' ? (
                <div className="message-bubble">
                  <img
                    src={msg.imageUrl || msg.content}
                    alt="Imagen enviada"
                    className="chat-image-upload"
                    onError={(e) => console.error("Error cargando imagen en chat", e)}
                  />
                </div>
              ) : msg.role === 'user' ? (
                <UserMessageWrapper content={msg.content} isHighlighted={isHighlighted} searchTerm={searchTerm}>
                  {renderContent(msg, msg.id || index)}
                </UserMessageWrapper>
              ) : (
                <div className="assistant-message-wrapper">
                  <div className="message-bubble">
                    <div dangerouslySetInnerHTML={{ __html: highlightSearchTerm(msg.content, searchTerm) }} />
                  </div>
                  
                  {/* BARRA EXTERNA: Solo si el mensaje es estable */}
                  {(msg.stable || msg.id) && (
                    <div className="assistant-external-actions">
                      <AssistantActions content={msg.content} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;