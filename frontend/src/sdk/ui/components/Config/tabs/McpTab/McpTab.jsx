// src/sdk/components/config/tabs/McpTab/McpTab.jsx
import React, { useState, useEffect, useRef } from 'react';

// Componentes internos del SDK
import McpTestMode from './utils/McpTestMode';
import { MCPSearchPanel } from '../../../SearchBar/utils/MCPSearchPanel'; 

// Hooks y Core del SDK
import { useJarvis } from '../../../../../hooks/useJarvis';
import Logger from '../../../../../utils/logger';

// Iconos
import { FcGoogle } from 'react-icons/fc';
import { AiOutlineCloudServer } from 'react-icons/ai';
import { SiNotion, SiMysql } from 'react-icons/si';
import { IoPrismOutline } from 'react-icons/io5';
import { FaGithub, FaCheckCircle, FaTimesCircle } from 'react-icons/fa';

import './McpTab.css';

const log = new Logger('McpTab');

const McpTab = () => {
  const [mainView, setMainView] = useState('');
  // Obtenemos la lógica desde el SDK
  const { client, connectGoogleCalendar, serviceConnections, setServiceConnections } = useJarvis();
  const [connectingService, setConnectingService] = useState(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);

  // ← Caché local para no perder el estado entre renders
  const cachedConnections = useRef(serviceConnections || {});

  // Cuando llega estado nuevo del contexto, actualizamos el caché
  useEffect(() => {
    if (serviceConnections) {
      cachedConnections.current = serviceConnections;
    }
  }, [serviceConnections]);

  // El estado que se muestra en UI usa el caché mientras carga
  const displayConnections = isLoadingStatus 
    ? cachedConnections.current  // ← muestra lo que había mientras carga
    : (serviceConnections || cachedConnections.current);

  const integrationApi = {
    getStatus: async () => {
      const response = await client.get('/api/v1/integrations/status'); 
      return response.data;
    },
    disconnect: async (provider) => {
      const response = await client.post(`/api/v1/integrations/disconnect/${provider}`);
      return response.data;
    }
  };

  const fetchIntegrationStatus = async () => {
    setIsLoadingStatus(true)
    try {
      const response = await client.get('/api/v1/integrations/status');
      const status = response.data;
      cachedConnections.current = status; // ← actualizar caché
      if (setServiceConnections) setServiceConnections(status);
    } catch (error) {
      log.error('Error fetching integration status:', error);
      // Si falla, dejamos el caché como estaba — no borramos el estado
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchIntegrationStatus();
    const params = new URLSearchParams(window.location.search);
    if (params.get("connection_success") || params.get("error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleServiceConnect = async (serviceName) => {
    setConnectingService(serviceName);
    try {
      if (serviceName === 'google_calendar') {
        await connectGoogleCalendar(); // Usamos la función del SDK
      } else {
        // Simulación para otros servicios
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (setServiceConnections) {
          setServiceConnections(prev => ({ ...prev, [serviceName]: true }));
        }
        alert(`${serviceName} connected (Simulated)`);
      }
    } catch (error) {
      log.error(`Error connecting to ${serviceName}:`, error);
    } finally {
      if (serviceName !== 'google_calendar') setConnectingService(null);
    }
  };

  const handleServiceDisconnect = async (serviceName) => {
    try {
      await integrationApi.disconnect(serviceName); 
      await fetchIntegrationStatus();
    } catch (error) {
      log.error(`Error disconnecting ${serviceName}:`, error);
    }
  };

  // Sub-componente de tarjeta (local)
  const ServiceConnectionCard = ({ service, icon, name, description, connected, onConnect, onDisconnect, isConnecting, badge }) => (
    <div className={`service-connection-card ${connected ? 'connected' : ''}`}>
      <div className="service-connection-header">
        <div className="service-connection-icon">{icon}</div>
        <div className="service-connection-info">
          <h4 className="service-connection-name">
            {name}
            {badge && <span className="service-connection-badge developing"> {badge}</span>}
          </h4>
          <p className="service-connection-description">{description}</p>
        </div>
        <div className="service-connection-status">
          {connected ? <FaCheckCircle className="status-icon connected" /> : <FaTimesCircle className="status-icon disconnected" />}
        </div>
      </div>
      <div className="service-connection-actions">
        {!connected ? (
          <button className="service-connect-btn" onClick={() => onConnect(service)} disabled={isConnecting}>
            {isConnecting ? 'Conectando...' : 'Conectar'}
          </button>
        ) : (
          <button className="service-disconnect-btn" onClick={() => onDisconnect(service)}>Disconnect</button>
        )}
      </div>
    </div>
  );

  // VISTAS
  if (mainView === 'server') {
    return (
      <div className="mcp-tab-container">
        <MCPSearchPanel />
        <div className="mcp-footer">
          <button onClick={() => setMainView('')} className="mcp-back-button red">Back</button>
        </div>
      </div>
    );
  }

  if (mainView === 'prueba') {
    return <McpTestMode setMainView={setMainView} />;
  }

  return (
    <div className="mcp-main-view">
      <h2 className="mcp-main-title">Model Context Protocol</h2>
      <div className="service-connections-section">
        <div className="service-connections-grid">
          <ServiceConnectionCard
            service="google_calendar"
            icon={<FcGoogle size={32} />}
            name="Google Calendar"
            description="Manage events"
            connected={displayConnections?.google_calendar}
            onConnect={handleServiceConnect}
            onDisconnect={handleServiceDisconnect}
            isConnecting={connectingService === 'google_calendar'}
          />
          {/* ... Repetir para GitHub, MySQL, etc ... */}
          <ServiceConnectionCard
            service="github"
            icon={<FaGithub size={32} color="#fff" />}
            name="GitHub"
            description="Manage repositories and PRs"
            connected={displayConnections?.github}
            onConnect={handleServiceConnect}
            onDisconnect={handleServiceDisconnect}
            isConnecting={connectingService === 'github'}
          />
            {/* Notion */}
            <ServiceConnectionCard
              service="notion"
              icon={<SiNotion size={32} color="#fff" />}
              name="Notion"
              description="Interact with pages and databases"
              connected={displayConnections?.notion}
              onConnect={handleServiceConnect}
              onDisconnect={handleServiceDisconnect}
              isConnecting={connectingService === 'notion'}
              badge="Developing"
            />

            {/* Nueva tarjeta: MySQL */}
            <ServiceConnectionCard
              service="mysql"
              icon={<SiMysql size={32} color="#4479A1" />}
              name="MySQL"
              description="Execute queries against your database"
              connected={displayConnections?.mysql}
              onConnect={handleServiceConnect}
              onDisconnect={handleServiceDisconnect}
              isConnecting={connectingService === 'mysql'}
              badge="Developing"
            />
        </div>
      </div>

      <div className="mcp-main-buttons">
        <button onClick={() => setMainView('server')} className="mcp-main-button server">
          <AiOutlineCloudServer size={48} color="#fff" />
          <span>Server</span>
        </button>
        <button onClick={() => setMainView('prueba')} className="mcp-main-button prueba">
          <IoPrismOutline size={48} color="#fff" />
          <span>Test</span>
        </button>
      </div>
    </div>
  );
};

export default McpTab;