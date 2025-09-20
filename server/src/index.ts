import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import { RoomService } from './services/RoomService';
import { SocketService } from './services/SocketService';
import { FileManager } from './services/FileManager';
import { createRoomRoutes } from './routes/rooms';
import { createFileRoutes } from './routes/files';
import { generalRateLimit, strictRateLimit } from './middleware/rateLimit';
import { log } from './utils/logger';
import type { APIResponse } from '@cloud-clipboard/shared';

const app = express();
const server = createServer(app);
const port = process.env.PORT || 3001;

// Determine if we're serving static files (production mode)
// Temporarily hardcode to true for testing
const isProduction = true; // process.env.NODE_ENV === 'production';
const staticPath = process.env.STATIC_PATH || path.join(__dirname, '../public');

console.log('DEBUG: NODE_ENV =', process.env.NODE_ENV);
console.log('DEBUG: isProduction =', isProduction);
console.log('DEBUG: staticPath =', staticPath);

// Security headers - conditionally based on HTTP/HTTPS mode
const allowHttp = process.env.ALLOW_HTTP === 'true';
console.log('DEBUG: ALLOW_HTTP =', process.env.ALLOW_HTTP);
console.log('DEBUG: allowHttp =', allowHttp);

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: allowHttp ? false : { policy: 'same-origin' },
  contentSecurityPolicy: allowHttp ? false : {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: allowHttp ? false : {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  originAgentCluster: allowHttp ? false : true,
}));

// CORS configuration
if (isProduction) {
  // In production, we serve both frontend and backend from the same origin
  app.use(cors({
    origin: function (_origin, callback) {
      // Allow same-origin requests (frontend served from same server)
      // and requests with no origin (like mobile apps)
      return callback(null, true);
    },
    credentials: true,
  }));
} else {
  // In development, allow specific origins
  const allowedOrigins = process.env.CLIENT_URL 
    ? process.env.CLIENT_URL.split(',')
    : ['http://localhost:3000', 'http://localhost:3002'];

  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }));
}

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Global rate limiting
app.use(generalRateLimit.middleware());

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const fileManager = new FileManager();
const roomService = new RoomService();
const socketService = new SocketService(server, roomService);

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

// Serve static files in production
if (isProduction) {
  // Serve static files from the built client
  app.use(generalRateLimit.middleware(), express.static(staticPath, {
    maxAge: '1d', // Cache static assets for 1 day
    etag: true,
    lastModified: true,
  }));
}

app.use('/api/rooms', createRoomRoutes(roomService));
app.use('/api/files', createFileRoutes(fileManager));

app.get('/api/health', (_req, res: express.Response<APIResponse>) => {
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

app.get('/api', (_req, res: express.Response<APIResponse>) => {
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

// Handle frontend routes in production (SPA fallback)
if (isProduction) {
  app.get('*', strictRateLimit.middleware(), (_req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });
} else {
  // In development, only handle API 404s
  app.use('*', (_req, res: express.Response<APIResponse>) => {
    res.status(404).json({
      success: false,
      message: 'API endpoint not found',
    });
  });
}

app.use((error: Error, _req: express.Request, res: express.Response<APIResponse>, _next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
});

server.listen(port, () => {
  log.info('Cloud Clipboard server started', {
    port,
    environment: process.env.NODE_ENV || 'development',
    logLevel: log.getConfig().level
  }, 'Server');
  log.info('WebSocket server ready for connections', {}, 'Server');
});

process.on('SIGTERM', () => {
  log.info('SIGTERM received. Shutting down gracefully...', {}, 'Server');
  roomService.destroy();
  fileManager.destroy();
  server.close(() => {
    log.info('Server closed', {}, 'Server');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log.info('SIGINT received. Shutting down gracefully...', {}, 'Server');
  roomService.destroy();
  fileManager.destroy();
  server.close(() => {
    log.info('Server closed', {}, 'Server');
    process.exit(0);
  });
});