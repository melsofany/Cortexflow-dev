import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const API_SERVER = (import.meta.env.VITE_API_URL as string) || '';

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(API_SERVER || '/', { path: '/api/socket' });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    return () => {
      socket.disconnect();
    };
  }, []);

  return { socket: socketRef.current, connected };
}
