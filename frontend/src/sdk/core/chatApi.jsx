// src/sdk/core/chatApi.jsx
//import apiClient from './client';

// 1. Obtener todos los chats
export const getAllChats = async (client) => {
  try {
    const res = await client.get('/api/v1/chat');
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Error al obtener los chats');
  }
};

// 2. Obtener mensajes de un chat específico
export const getChatMessages = async (client, chatId) => {
  try {
    const res = await client.get(`/api/v1/chat/${chatId}/messages`);
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Error al obtener los mensajes');
  }
};

// 3. Crear un nuevo chat
export const createChat = async (client, newChat) => {
  try {
    const res = await client.post('/api/v1/chat', newChat);
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Error al crear el chat');
  }
};

// 5. Borrar un chat (opcional)
export const deleteChat = async (client, chatId) => {
  try {
    await client.delete(`/api/v1/chat/${chatId}`);
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Error al borrar el chat');
  }
};

// 6. Editar título del chat (opcional)
export const updateChatTitle = async (client, chatId, newTitle) => {
  try {
    const res = await client.put(`/api/v1/chat/${chatId}/title`, { title: newTitle });
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Error al actualizar el título del chat');
  }
};

// 7. Mensajes recientes para paginación (nuevo endpoint optimizado para paginación)
export const fetchChatMessages = async (client, chatId) => {
  try {
    const res = await client.get(`/api/v1/chat/${chatId}/messages/recent`);
    return res.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Error al obtener los mensajes recientes');
  }
};