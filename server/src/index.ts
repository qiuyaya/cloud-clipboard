import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { RoomService } from './services/RoomService';
import { SocketService } from './services/SocketService';
import { FileManager } from './services/FileManager';
import { createRoomRoutes } from './routes/rooms';
import { createFileRoutes } from './routes/files';
import type { APIResponse } from '@cloud-clipboard/shared';

const app = express();
const server = createServer(app);
const port = process.env.PORT || 3001;

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
}));

app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const fileManager = new FileManager();
const roomService = new RoomService();
const socketService = new SocketService(server, roomService, fileManager);

// Handle room destruction events - cleanup files and notify users
roomService.on('roomDestroyed', (roomKey: string) => {
  const deletedFiles = fileManager.deleteRoomFiles(roomKey);
  
  if (deletedFiles.length > 0) {
    // Broadcast file deletion notifications to any remaining connections
    const io = socketService.getIO();
    io.to(roomKey).emit('roomDestroyed', {
      roomKey,
      deletedFiles: deletedFiles.map(f => f.filename)
    });
    
    console.log(`Room ${roomKey} destroyed - deleted ${deletedFiles.length} files`);
  }
});

app.use('/api/rooms', createRoomRoutes(roomService));
app.use('/api/files', createFileRoutes(fileManager));

app.get('/api/health', (req, res: express.Response<APIResponse>) => {
  const roomStats = roomService.getRoomStats();
  const fileStats = fileManager.getStats();
  res.json({
    success: true,
    message: 'Server is healthy',
    data: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
      ...roomStats,
      ...fileStats,
    },
  });
});

app.get('/api', (req, res: express.Response<APIResponse>) => {
  res.json({
    success: true,
    message: 'Cloud Clipboard API v1.0.0',
    data: {
      version: '1.0.0',
      endpoints: {
        rooms: '/api/rooms',
        files: '/api/files',
        health: '/api/health',
      },
    },
  });
});

app.use('*', (req, res: express.Response<APIResponse>) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
  });
});

app.use((error: Error, req: express.Request, res: express.Response<APIResponse>, next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
});

server.listen(port, () => {
  console.log(`🚀 Cloud Clipboard server running on port ${port}`);
  console.log(`📡 WebSocket server ready for connections`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  roomService.destroy();
  fileManager.destroy();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  roomService.destroy();
  fileManager.destroy();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});