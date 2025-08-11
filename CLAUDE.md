# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development
- `bun run dev` - Start both server and client in development mode (server on port 3001, client on port 3000/3002)
- `bun run shared:build` - Build shared package (must be run after modifying shared types/schemas)
- `bun run server:dev` - Start only the server (port 3001)
- `bun run client:dev` - Start only the client (port 3000)
- `bun run build` - Build all packages for production

### Code Quality
- `bun run lint` - Run ESLint on all TypeScript files
- `bun run type-check` - Run TypeScript compiler without emitting files

## Architecture

### Monorepo Structure
This is a Bun-based monorepo with three workspaces that must be built in dependency order:

1. **`shared/`** - Core types and validation schemas using Zod
2. **`server/`** - Express.js + Socket.IO backend 
3. **`client/`** - React + Vite frontend

### Key Architectural Patterns

**Shared Type System**: All types are defined in `shared/src/types.ts` and derived from Zod schemas in `shared/src/schemas.ts`. Both client and server import these for type safety.

**WebSocket Communication**: Real-time features use Socket.IO with strictly typed events defined in `ServerToClientEvents` and `ClientToServerEvents` interfaces.

**Room-Based Architecture**: Users join rooms using room keys. All data (users, messages) is scoped to rooms and stored in-memory only.

**Date Serialization Handling**: WebSocket transmission converts Date objects to strings. The `formatTimestamp` utility function in `shared/src/utils.ts` handles both Date objects and date strings to prevent RangeError exceptions.

### Critical Dependencies

**After modifying shared package**: Always run `bun run shared:build` before starting development servers, as both client and server depend on the compiled shared package.

**WebSocket Connection Management**: The client uses a singleton `socketService` in `client/src/services/socket.ts`. Connection stability is managed through careful useEffect dependencies in `App.tsx`.

**Message Validation**: All WebSocket messages are validated using Zod schemas. The server generates message IDs and timestamps; clients should not attempt to create complete message objects.

### Data Flow

1. **User joins room**: Client sends `JoinRoomRequest` → Server validates → Creates `User` object → Broadcasts to room
2. **Message sending**: Client sends minimal message data → Server adds ID, timestamp, sender → Validates with Zod → Broadcasts to all room participants
3. **File uploads**: Client uploads to `/api/files/upload` → Server stores and returns download URL → Message sent via WebSocket

### State Management

**Client**: React state managed in `App.tsx` with careful WebSocket event handler setup to prevent reconnection loops.

**Server**: In-memory storage using `RoomService` with `Map<RoomKey, RoomModel>`. Users are tracked in both `socketUsers` (socketId → User) and `userSockets` (userId → socketId) maps.

### Internationalization

Uses react-i18next with translations in `client/src/i18n/locales/`. All user-facing text should use `t()` function calls, not hardcoded strings.

### Important Notes

- No persistent storage - all data is in-memory only
- Files are uploaded to server storage, not database
- Maximum file size is 100MB
- Room keys can be any non-empty string
- Users are automatically removed from rooms on disconnect

### Common Issues and Fixes

**Date Serialization**: WebSocket transmission converts Date objects to strings. Always check for and convert string dates back to Date objects before Zod validation:
```typescript
const userWithDate = {
  ...user,
  lastSeen: typeof user.lastSeen === 'string' ? new Date(user.lastSeen) : user.lastSeen,
};
```

**File Upload URLs**: Server returns absolute URLs for file downloads. The client handles both relative and absolute URL formats for backwards compatibility.