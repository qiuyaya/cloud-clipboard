# Cloud Clipboard

A real-time cloud clipboard application that allows you to share text and files across different devices securely using room-based authentication.

## Features

- 🔐 **Secure Room Authentication** - Enter the same room key to join and share data
- 📝 **Text Sharing** - Copy and paste text instantly across devices
- 📁 **File Sharing** - Upload and download files up to 100MB
- 🔄 **Real-time Sync** - WebSocket-based instant synchronization
- 🌐 **P2P Support** - Direct file transfer for local network connections
- 🎨 **Modern UI** - Beautiful interface built with React, Tailwind CSS, and shadcn/ui
- ⚡ **Fast & Reliable** - Built with Bun, TypeScript, and strict type checking
- 📱 **Cross-Platform** - Works on desktop, tablet, and mobile devices

## Architecture

This project is built as a monorepo with three main packages:

- **`shared/`** - Common types, schemas, and utilities (TypeScript + Zod)
- **`server/`** - Backend API and WebSocket server (Node.js + Express + Socket.IO)
- **`client/`** - Frontend React application (React + Vite + Tailwind CSS)

## Tech Stack

### Backend
- **Runtime**: Bun
- **Framework**: Express.js
- **WebSockets**: Socket.IO
- **Validation**: Zod schemas
- **Security**: Helmet, CORS
- **File Upload**: Multer

### Frontend
- **Framework**: React 18
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui (Radix UI)
- **WebSocket Client**: Socket.IO Client
- **Validation**: Zod schemas

### Shared
- **Type System**: TypeScript with strict mode
- **Validation**: Zod schemas
- **Utilities**: Shared utility functions

## Getting Started

### Prerequisites
- [Bun](https://bun.sh) installed on your system

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```

3. Build the shared package:
   ```bash
   bun run shared:build
   ```

### Development

Start both server and client in development mode:
```bash
bun run dev
```

Or start them separately:

**Server** (runs on http://localhost:3001):
```bash
bun run server:dev
```

**Client** (runs on http://localhost:3000):
```bash
bun run client:dev
```

### Production

Build all packages:
```bash
bun run build
```

Start the server:
```bash
cd server && bun run start
```

## Usage

1. **Join a Room**: Enter a room key (any string) and your name
2. **Share Text**: Type or paste text and click Send
3. **Share Files**: Click the File button to upload files (max 100MB)
4. **Copy Text**: Click the Copy button on any text message
5. **Download Files**: Click the Download button on file messages
6. **Multiple Users**: Share the same room key with others to collaborate

## Security Features

- **Room Isolation**: Users in different rooms cannot see each other's data
- **No Persistent Storage**: Messages are only kept in memory during the session
- **Secure Headers**: Helmet.js provides security headers
- **Input Validation**: All data is validated using Zod schemas
- **CORS Protection**: Configurable CORS settings

## File Transfer

- **Server Upload**: Files are uploaded to the server for sharing
- **P2P Transfer**: Direct device-to-device transfer for local network (WebRTC)
- **Size Limit**: Maximum file size of 100MB
- **Type Support**: All file types are supported

## API Endpoints

### Rooms
- `POST /api/rooms/create` - Create a new room
- `GET /api/rooms/info` - Get room information
- `GET /api/rooms/users` - Get users in room
- `GET /api/rooms/messages` - Get recent messages
- `GET /api/rooms/stats` - Get server statistics

### Files
- `POST /api/files/upload` - Upload a file
- `GET /api/files/download/:fileId` - Download a file
- `DELETE /api/files/:fileId` - Delete a file

### Health
- `GET /api/health` - Server health check
- `GET /api/` - API information

## WebSocket Events

### Client to Server
- `joinRoom` - Join a room
- `leaveRoom` - Leave a room
- `sendMessage` - Send text or file message
- `requestUserList` - Get list of users in room
- `p2pOffer`, `p2pAnswer`, `p2pIceCandidate` - WebRTC signaling

### Server to Client
- `message` - New message received
- `userJoined` - User joined the room
- `userLeft` - User left the room
- `userList` - Updated list of users
- `error` - Error message
- `p2pOffer`, `p2pAnswer`, `p2pIceCandidate` - WebRTC signaling

## Environment Variables

### Server
- `PORT` - Server port (default: 3001)
- `CLIENT_URL` - Frontend URL for CORS (default: *)
- `NODE_ENV` - Environment mode

### Client
- `VITE_SERVER_URL` - Backend server URL (default: http://localhost:3001)

## Development Commands

```bash
# Install dependencies
bun install

# Start development servers
bun run dev

# Build all packages
bun run build

# Run type checking
bun run type-check

# Run linting
bun run lint

# Build individual packages
bun run shared:build
bun run server:build
bun run client:build

# Start individual services
bun run server:dev
bun run client:dev
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).