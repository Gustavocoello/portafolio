// src/ui/components/Config/ConfigPage.jsx
import React from 'react'; // Siempre importa React en el SDK
import ConfigDrawer from './ConfigDrawer';
import { useJarvis } from '../../../hooks/useJarvis'; 
import './ConfigDrawer.css';

const ConfigPage = ({ onCustomClose }) => {
  const { isAuthenticated } = useJarvis();

  const handleClose = () => {
    if (onCustomClose) {
      onCustomClose();
    } else {
      // Si no hay onCustomClose, usamos el historial del navegador para volver atrás
      window.history.back();
    }
  };

  // DEBUG: Si esto sale en consola como 'false', el return null es el culpable
  console.log("Estado de autenticación en Config:", isAuthenticated);

  // COMENTA ESTO TEMPORALMENTE para ver si el componente aparece:
  // if (!isAuthenticated) return null;

  return (
    <div className="config-page-wrapper"> 
      <ConfigDrawer onClose={handleClose} />
    </div>
  );
};

export default ConfigPage;