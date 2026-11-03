///features/chat/components/Messagelist.jsx
import React, { useEffect, useRef, useState } from 'react';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import CodeBlock from '../CodeBlock/CodeBlock';
import MarkdownRenderer from '../../../utils/MarkdownRenderer';
// Icons 
import { LuCopy } from "react-icons/lu";
import { FaArrowTurnDown, FaArrowTurnUp } from "react-icons/fa6";
import { LiaThumbtackSolid } from "react-icons/lia";

import './MessageList.css';

// Solo "Copiar": me gusta, no me gusta, rehacer, compartir y exportar eran botones sin función
const AssistantActions = ({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="assistant-actions-toolbar">
      <button className="toolbar-btn" onClick={handleCopy} title={copied ? 'Copiado' : 'Copiar'} aria-label="Copiar respuesta">
        <LuCopy size={16} color={copied ? "#4ade80" : "inherit"} />
      </button>
    </div>
  );
};

const UserMessageWrapper = ({ content, children, isHighlighted }) => {
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

// La carga de mensajes viejos al subir vive en ChatContainer: el que scrollea es .content-area, no esta lista
const MessageList = ({ messages = [], searchTerm = '' }) => {
  const messagesEndRef = useRef(null);

  // Baja al final solo cuando llega un mensaje nuevo abajo; al cargar mensajes viejos arriba no salta
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lastId]);

  const filteredMessages = messages
    .filter(msg => !msg.html?.includes('[NOTIFICATION]'))
    .map(msg => ({
      ...msg,
      // Si tiene ID, es un mensaje guardado, por lo tanto es estable
      stable: msg.id ? true : msg.stable 
    }));

  // El HTML del mensaje (markdown ya renderizado) en bloques: el texto seguido va en UN contenedor saneado,
  // y cada bloque de código en su CodeBlock. Antes cada párrafo era un div aparte.
  const renderContent = (msg, keyPrefix) => {
    try {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = DOMPurify.sanitize(msg.html || '');
      const parts = [];
      let buffer = '';
      const flush = () => {
        if (!buffer.trim()) { buffer = ''; return; }
        parts.push(<div key={`${keyPrefix}-${parts.length}`} className="message-html" dangerouslySetInnerHTML={{ __html: buffer }} />);
        buffer = '';
      };

      for (const node of Array.from(tempDiv.childNodes)) {
        const codeEl = node.nodeType === Node.ELEMENT_NODE && node.tagName === 'PRE' ? node.querySelector('code') : null;
        if (!codeEl) {
          buffer += node.nodeType === Node.ELEMENT_NODE ? node.outerHTML : (node.textContent || '');
          continue;
        }
        flush();
        const content = codeEl.textContent.trim();
        let language = (codeEl.getAttribute('class') || '').replace('language-', '') || 'plaintext';
        if (!hljs.getLanguage(language)) language = 'plaintext';
        const highlighted = msg.stable ? content : hljs.highlight(content, { language }).value;
        parts.push(
          <CodeBlock
            key={`${keyPrefix}-${parts.length}`}
            code={highlighted}
            language={language}
            isHtml={!msg.stable}
            stable={msg.stable ?? true}
          />
        );
      }
      flush();
      return parts;
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
    <div className="message-list-wrapper">
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
                  {/* Antes se insertaba msg.content como HTML crudo: sin markdown y sin sanear */}
                  <div className="message-bubble">
                    {renderContent(msg, msg.id || index)}
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