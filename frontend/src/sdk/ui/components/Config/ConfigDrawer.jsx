// src/sdk/components/config/ConfigDrawer.jsx
import { useState } from 'react';
import ThemeTab from './tabs/Theme/ThemeTab';
import GeneralTab from './tabs/General/GeneralTab';
import McpTab from './tabs/McpTab/McpTab';
import './ConfigDrawer.css';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'conexiones', label: 'Conexiones' },
  { id: 'tema', label: 'Tema' },
];

const ConfigDrawer = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState('general');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayTab, setDisplayTab] = useState('general');

  const handleTabChange = (newTab) => {
    if (newTab === activeTab) return;
    
    setIsTransitioning(true);
    
    setTimeout(() => {
      setActiveTab(newTab);
      setDisplayTab(newTab);
      setIsTransitioning(false);
    }, 150);
  };

  return (
    <div className="drawer-backdrop drawer-backdrop-animated" onClick={onClose}>
      <div className="drawer-panel drawer-panel-animated" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h2>Configuración</h2>
          <button className="close-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="drawer-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={activeTab === t.id ? 'active' : ''}
              onClick={() => handleTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="drawer-content">
          <div className={`content-wrapper-config ${isTransitioning ? 'transitioning' : ''}`}>
            {displayTab === 'general' && <GeneralTab />}
            {displayTab === 'conexiones' && <McpTab />}
            {displayTab === 'tema' && <ThemeTab />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigDrawer;