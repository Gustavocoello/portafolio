// jarvis-sdk/src/index.jsx

// 1. Contexto y Hook Maestro (Ahora en src/context y src/hooks)
export { JarvisProvider } from './context/JarvisProvider';
export { useJarvis } from './hooks/useJarvis';

// 2. Core (Lógica pura: API, Stream, Eventos)
export { sendMessage, sendAnonymousMessage, extractFileContent } from './core/stream';
export { chatEvents } from './core/events';

export { 
  fetchChatMessages, 
  getAllChats, 
  createChat, 
  updateChatTitle,
  deleteChat,
  getChatMessages, 
} from './core/chatApi';

// 3. Hooks (Músculos de la UI - ahora todos en src/hooks)
export { useChatActions } from './hooks/useChatActions';
export { useChatMessages } from './hooks/useChatMessages';
export { useChatState } from './hooks/useChatState';
export { useChatUI } from './hooks/useChatUI';

// 4. Componentes de UI (Exportamos desde la nueva ruta src/ui/components)
export { default as ChatContainer } from './ui/components/ChatContainer/ChatContainer';
export { default as Sidebar } from './ui/components/Sidebar/Sidebar';
export { default as ConfigDrawer } from './ui/components/Config/ConfigDrawer';
export { default as ConfigPage } from './ui/components/Config/ConfigPage';
export { default as SearchBar } from './ui/components/SearchBar/SearchBar';

// 5. Utilidades Visuales (El "corazón" animado)
export { default as AnimatedJarvis } from './ui/components/Sidebar/utils/AnimatedJarvis';

// 6. Estilos (Importamos el CSS desde src/styles)
import './ui/styles/jarvis-sdk.css';