// src/ui/components/Config/ConfigPage.jsx
import React from 'react'; // Siempre importa React en el SDK
import ConfigDrawer from './ConfigDrawer';

const ConfigPage = ({ onCustomClose }) => {

  const handleClose = () => {
    if (onCustomClose) {
      onCustomClose();
    } else {
      // Si no hay onCustomClose, usamos el historial del navegador para volver atrás
      window.history.back();
    }
  };

  return (
    <div className="config-page-wrapper"> 
      <ConfigDrawer onClose={handleClose} />
    </div>
  );
};

export default ConfigPage;