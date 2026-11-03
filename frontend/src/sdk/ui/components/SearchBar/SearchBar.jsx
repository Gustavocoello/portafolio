// src/sdk/components/SearchBar/SearchBar.jsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { extractFileContent } from '../../../core/stream';
import { FaArrowUp, FaStop } from 'react-icons/fa';
import { MdOutlineAttachFile } from "react-icons/md";
import { IoCloseOutline } from "react-icons/io5";
import { apiLogger } from '../../../utils/logger';
import './SearchBar.css';

const SearchBar = ({ onSearch, isStreaming, onStop, onContextExtracted, pendingContext, onRemoveContext, client, getToken, appId, notice }) => {
  const [query, setQuery] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const [pendingFilePreview, setPendingFilePreview] = useState([]);
  const [retryCount, setRetryCount] = useState(0);
  // Ref para no reconectar el SSE cada vez que el padre crea un getToken nuevo
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const VITE_APP = import.meta.env.VITE_URL;


  // ----------------- SEARCHBAR LOGIC -----------------
  // Auto-ajustar altura del textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 100) + 'px';
    }
  }, [query]);

  // Para escuchar eventos de SSE
  useEffect(() => {
    let eventSource;
    let cancelled = false;

    (async () => {
      // EventSource no puede mandar headers: el backend valida el token por query param
      const token = typeof getTokenRef.current === 'function' ? await getTokenRef.current() : null;
      if (!token || cancelled) return;
      const params = new URLSearchParams({ token, app_id: appId || 'jarvis-default' });
      eventSource = new EventSource(`${VITE_APP}/api/v1/chat/events?${params}`);

      eventSource.onmessage = (e) => {
        const event = JSON.parse(e.data);
        if (!event.filename) return;

        setPendingFilePreview(prev => prev.map(f => {
          // IMPORTANTE: Asegúrate de que event.filename coincida exactamente con f.name
          if (f.name === event.filename) {
            if (event.type === "upload_started") return { ...f, loading: true, progress: 60 };
            if (event.type === "upload_completed") return { ...f, loading: false, progress: 100, error: false, url: event.url };
            if (event.type === "upload_error") return { ...f, loading: false, progress: 0, error: true };
          }
          return f;
        }));
      };

      eventSource.onerror = (err) => {
        apiLogger.error("SSE Error - Intentando reconectar...", err);
        eventSource.close();
        // Reintentar conexión tras 3 segundos si falla
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 3000);
      };
    })();

    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, [VITE_APP, appId, retryCount]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && query.trim()) {
      e.preventDefault();
      triggerSearch();
    }
  };

  const triggerSearch = () => {
    const lastUploadedImage = localStorage.getItem('lastUploadedImage');
    const shouldSendImage = pendingFilePreview.length > 0 && lastUploadedImage;
    const imageToSend = shouldSendImage ? lastUploadedImage : null;

    if (query.trim() || imageToSend) {
      apiLogger.info('TriggerSearch: Iniciando búsqueda', { query: query.length > 0, hasImage: !!imageToSend });
      onSearch(query, pendingContext, imageToSend, "");
    }

    // Resetar input y archivos
    setQuery('');
    setPendingFilePreview([]);
    localStorage.removeItem('lastUploadedImage');
};

  const handleFileSelect = () => {
    fileInputRef.current.click();
    apiLogger.debug('FileSelect: Abriendo diálogo de archivos');
  };
  // ----------------- FILE UPLOAD LOGIC -----------------
  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const allAreImages = files.every(file => file.type.startsWith("image/"));

    if (allAreImages) {
      await handleImageUploadOnly(files);
      e.target.value = null;
      return;
    }


    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileType = file.type;

      let icon = '📎';
      if (fileType.includes('pdf')) icon = '📄';
      else if (fileType.includes('spreadsheet') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) icon = '📊';
      else if (fileType.includes('image')) icon = '🖼️';

      const previewUrl = fileType.includes('image') ? URL.createObjectURL(file) : null;

      const fileState = {
        name: file.name,
        type: fileType,
        icon,
        previewUrl,
        progress: 10,
        loading: true
      };

      setPendingFilePreview(prev => [...prev, fileState]);

      const formData = new FormData();
      formData.append('file', file);

      try {

        const data = await extractFileContent(file, client, getToken, appId);

        if (data.text) {
          onContextExtracted({ name: file.name, text: data.text });
        }

        setPendingFilePreview(prev =>
          prev.map(f =>
            f.name === file.name ? { ...f, progress: 50, loading: true} : f
          )
        );
      } catch (err) {
        apiLogger.error(`FileChange: Error al procesar archivo ${file.name}`, err.message);
        alert('Error al procesar archivo: ' + err.message);

        setPendingFilePreview(prev =>
          prev.map(f =>
            f.name === file.name ? { ...f, progress: 100, loading: false } : f
          )
        );
      }
    }

    e.target.value = null;
  };

  // ----------------- IMAGE UPLOAD LOGIC -----------------
  const handleImageUploadOnly = useCallback(async (images) => {

    for (let i = 0; i < images.length; i++) {
      const file = images[i];
      if (!file.type.startsWith("image/")) continue;

      const reader = new FileReader();

      reader.onloadend = async () => {
        const base64Image = reader.result;

        // Guarda temporalmente en localStorage
        localStorage.setItem('lastUploadedImage', base64Image);

        const fileState = {
          name: file.name,
          type: file.type,
          icon: '🖼️',
          previewUrl: base64Image,
          file,
          progress: 10,
          loading: true
        };

        // Actualiza los estados visuales
        setPendingFilePreview(prev => [...prev, fileState]);

        try {
          const data = await extractFileContent(file, client, getToken, appId);
          if (data.text) {
            onContextExtracted({ name: file.name, text: data.text });
          }

          setPendingFilePreview(prev =>
            prev.map(f =>
              f.name === file.name ? { ...f, progress: 50} : f
            )
          );
        } catch (err) {
          apiLogger.error(`[SEARCHBAR] - ImageUpload: Error al subir imagen ${file.name}`, err.message);
          alert('Error al subir imagen: ' + err.message);
        }
      };

      reader.readAsDataURL(file);
    }
  }, [onContextExtracted, client, getToken, appId]);

  useEffect(() => {
    // Por si quedó algo colgado
    localStorage.removeItem('lastUploadedImage');
  }, []);


  // Para pasar imagenes desde el portapapeles
  useEffect(() => {
  const handlePaste = async (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const imageItems = Array.from(items).filter(item => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;

    const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
    if (files.length > 0) {
      await handleImageUploadOnly(files);
    }
  };

  document.addEventListener("paste", handlePaste);
  return () => document.removeEventListener("paste", handlePaste);
}, [handleImageUploadOnly]);

  return (
    <div className="search-bar-wrapper">
  {notice && <div className="search-notice" role="status">{notice}</div>}
  {/* Caja redondeada que contiene todo lo que se expande */}
  <div className="search-box-container">
    {/* Vista previa del archivo */}
    {Array.isArray(pendingFilePreview) && pendingFilePreview.length > 0 && (
      <div className="file-preview-container-horizontal">
        {pendingFilePreview.map((file, index) => (
          <div className="file-preview-inside" key={index}>
            {file.previewUrl ? (
              <img src={file.previewUrl} alt="preview" className="file-preview-image" />
            ) : (
              <span className="file-icon">{file.icon}</span>
            )}
            <span className="file-name">{file.name}</span>
            <button
              className="remove-file-button"
              onClick={() => {
                const fileToRemove = pendingFilePreview[index];
                setPendingFilePreview(prev => prev.filter((_, i) => i !== index));
                onRemoveContext(fileToRemove.name);
                // Limpiar del localstorage
                localStorage.removeItem('lastUploadedImage');
              }}
              aria-label="Eliminar archivo"
            >
              <IoCloseOutline size={18} />
            </button>
            {file.loading && (
              <div className="circular-progress-overlay">
                <svg className={`circular-progress ${file.error ? 'error' : ''}`} viewBox="0 0 36 36">
                  <path
                    className="circle-bg"
                    strokeDasharray={`${file.progress}, 100`} // Esto controla el avance
                    style={{ transition: 'stroke-dasharray 0.5s ease' }}
                    d="M18 2.0845
                      a 15.9155 15.9155 0 0 1 0 31.831
                      a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className="circle"
                    strokeDasharray={`${file.progress}, 100`}
                    d="M18 2.0845
                      a 15.9155 15.9155 0 0 1 0 31.831
                      a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <text x="18" y="20.35" className="percentage">{file.progress}%</text>
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    )}
    {/* Campo de búsqueda */}


    {/* Textarea y botón enviar */}
    <div className="textarea-container">
      <textarea
        ref={textareaRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyPress}
        placeholder="Message Jarvis…"
        rows={1}
        className="search-textarea"
      />
      {isStreaming ? (
        <FaStop className="stop-icon" onClick={onStop} />
      ) : (
        <FaArrowUp className="arrow-icon" onClick={triggerSearch} />
      )}
    </div>

    {/* Adjuntar imágenes y archivos (Jarvis elige solo qué herramienta usar) */}
    <div className="plus-menu-container">
      <button type="button" className="attach-btn" onClick={handleFileSelect} aria-label="Adjuntar imágenes y archivos" title="Adjuntar imágenes y archivos">
        <MdOutlineAttachFile />
      </button>
    </div>

    {/* Input oculto para seleccionar archivos */}
    <input
      type="file"
      ref={fileInputRef}
      onChange={handleFileChange}
      style={{ display: 'none' }}
      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.ppt,.pptx"
      multiple
    />
  </div>
</div> 
);
};
export default SearchBar;