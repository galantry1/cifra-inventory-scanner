import { io, Socket } from 'socket.io-client';
import { API_URL } from './api';

export function connectRT(sid: string, userId: string) {
  const socket: Socket = io(API_URL, {
    transports: ['websocket', 'polling'], // безопаснее на мобильных
  });
  socket.on('connect', () => {
    socket.emit('join', { sid, userId });
  });
  return socket;
}
