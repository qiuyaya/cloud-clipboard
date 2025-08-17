# Testing Patterns and Best Practices

This document outlines common testing patterns, anti-patterns, and best practices specific to the Cloud Clipboard project.

## Table of Contents

- [Test Structure Patterns](#test-structure-patterns)
- [Mocking Patterns](#mocking-patterns)
- [React Component Testing](#react-component-testing)
- [WebSocket Testing](#websocket-testing)
- [File System Testing](#file-system-testing)
- [Error Handling Testing](#error-handling-testing)
- [Performance Testing](#performance-testing)
- [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

## Test Structure Patterns

### AAA Pattern (Arrange, Act, Assert)

```typescript
// ✅ Good: Clear AAA structure
it('should create a new room', () => {
  // Arrange
  const roomService = new RoomService();
  const roomKey = 'testroom123';
  
  // Act
  const room = roomService.createRoom(roomKey);
  
  // Assert
  expect(room.key).toBe(roomKey);
  expect(room.getUserList()).toHaveLength(0);
});
```

### Given-When-Then Pattern

```typescript
// ✅ Good: BDD-style test structure
describe('Room Management', () => {
  describe('given a room service', () => {
    let roomService: RoomService;
    
    beforeEach(() => {
      roomService = new RoomService();
    });
    
    describe('when creating a room', () => {
      it('then should return a room with the correct key', () => {
        const room = roomService.createRoom('test123');
        expect(room.key).toBe('test123');
      });
    });
  });
});
```

### Test Builder Pattern

```typescript
// ✅ Good: Flexible test data creation
class UserBuilder {
  private user: Partial<User> = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'TestUser',
    isOnline: true,
    lastSeen: new Date(),
    deviceType: 'desktop',
  };

  withName(name: string): UserBuilder {
    this.user.name = name;
    return this;
  }

  withDeviceType(deviceType: User['deviceType']): UserBuilder {
    this.user.deviceType = deviceType;
    return this;
  }

  build(): User {
    return this.user as User;
  }
}

// Usage
const mobileUser = new UserBuilder()
  .withName('MobileUser')
  .withDeviceType('mobile')
  .build();
```

## Mocking Patterns

### Service Dependency Injection

```typescript
// ✅ Good: Injectable dependencies for testing
class RoomController {
  constructor(
    private roomService: RoomService,
    private fileManager: FileManager
  ) {}
}

// Test with mocked dependencies
describe('RoomController', () => {
  let mockRoomService: jest.Mocked<RoomService>;
  let mockFileManager: jest.Mocked<FileManager>;
  let controller: RoomController;

  beforeEach(() => {
    mockRoomService = {
      createRoom: jest.fn(),
      getRoom: jest.fn(),
    } as any;
    
    mockFileManager = {
      deleteRoomFiles: jest.fn(),
    } as any;

    controller = new RoomController(mockRoomService, mockFileManager);
  });
});
```

### Socket.IO Mocking

```typescript
// ✅ Good: Comprehensive socket mocking
const createMockSocket = () => ({
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  close: vi.fn(),
  connected: false,
  id: 'mock-socket-id',
});

// Advanced socket event simulation
it('should handle connection events', () => {
  const mockSocket = createMockSocket();
  const connectHandler = vi.fn();
  
  socketService.on('connect', connectHandler);
  
  // Simulate connection
  const connectCallback = mockSocket.on.mock.calls
    .find(call => call[0] === 'connect')[1];
  connectCallback();
  
  expect(connectHandler).toHaveBeenCalled();
});
```

### File System Mocking

```typescript
// ✅ Good: Comprehensive fs mocking
import { jest } from 'bun:test';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
}));

// Test with controlled file system behavior
it('should handle file creation', () => {
  const mockFs = jest.mocked(fs);
  mockFs.existsSync.mockReturnValue(false);
  mockFs.writeFileSync.mockImplementation(() => {});
  
  fileManager.createFile('test.txt', 'content');
  
  expect(mockFs.writeFileSync).toHaveBeenCalledWith(
    expect.stringContaining('test.txt'),
    'content'
  );
});
```

## React Component Testing

### Component Testing with React Testing Library

```typescript
// ✅ Good: Testing user interactions
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('RoomJoin Component', () => {
  it('should handle form submission', async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    
    render(<RoomJoin onJoin={onJoin} />);
    
    // Fill form
    await user.type(screen.getByLabelText(/room key/i), 'room123');
    await user.type(screen.getByLabelText(/username/i), 'TestUser');
    
    // Submit
    await user.click(screen.getByRole('button', { name: /join/i }));
    
    // Verify
    expect(onJoin).toHaveBeenCalledWith({
      roomKey: 'room123',
      username: 'TestUser',
    });
  });
});
```

### Custom Hook Testing

```typescript
// ✅ Good: Testing custom hooks
import { renderHook, act } from '@testing-library/react';

describe('useSocket Hook', () => {
  it('should connect and disconnect', () => {
    const { result } = renderHook(() => useSocket());
    
    act(() => {
      result.current.connect();
    });
    
    expect(result.current.isConnected).toBe(true);
    
    act(() => {
      result.current.disconnect();
    });
    
    expect(result.current.isConnected).toBe(false);
  });
});
```

### Context Provider Testing

```typescript
// ✅ Good: Testing with context providers
const renderWithContext = (component: React.ReactElement) => {
  return render(
    <ThemeProvider>
      <SocketProvider>
        {component}
      </SocketProvider>
    </ThemeProvider>
  );
};

it('should access theme context', () => {
  renderWithContext(<ThemeToggle />);
  
  const toggleButton = screen.getByRole('button');
  expect(toggleButton).toBeInTheDocument();
});
```

## WebSocket Testing

### Real-time Event Testing

```typescript
// ✅ Good: Testing WebSocket event flows
describe('WebSocket Integration', () => {
  it('should handle message broadcasting', async () => {
    const server = createTestServer();
    const client1 = createTestClient();
    const client2 = createTestClient();
    
    // Both clients join room
    await Promise.all([
      client1.joinRoom('test123', 'User1'),
      client2.joinRoom('test123', 'User2'),
    ]);
    
    // Client1 sends message
    const messagePromise = waitForMessage(client2);
    client1.sendMessage('Hello!');
    
    // Client2 should receive message
    const receivedMessage = await messagePromise;
    expect(receivedMessage.content).toBe('Hello!');
    expect(receivedMessage.sender.name).toBe('User1');
  });
});

// Helper for waiting for WebSocket events
const waitForMessage = (client: TestClient): Promise<Message> => {
  return new Promise((resolve) => {
    client.on('message', resolve);
  });
};
```

### Connection State Testing

```typescript
// ✅ Good: Testing connection lifecycle
it('should handle reconnection after disconnect', async () => {
  const client = createTestClient();
  
  // Initial connection
  await client.connect();
  expect(client.isConnected()).toBe(true);
  
  // Simulate disconnect
  client.disconnect();
  expect(client.isConnected()).toBe(false);
  
  // Reconnect
  await client.connect();
  expect(client.isConnected()).toBe(true);
});
```

## File System Testing

### File Upload Testing

```typescript
// ✅ Good: Testing file operations
describe('File Manager', () => {
  it('should handle file upload and cleanup', async () => {
    const mockFile = {
      id: 'file-123',
      filename: 'test.txt',
      path: '/tmp/test.txt',
      roomKey: 'room123',
      uploadedAt: new Date(),
      size: 1024,
    };
    
    // Upload file
    fileManager.addFile(mockFile);
    expect(fileManager.getFile('file-123')).toEqual(mockFile);
    
    // Delete file
    const result = fileManager.deleteFile('file-123', 'manual');
    expect(result).toEqual({
      filename: 'test.txt',
      roomKey: 'room123',
    });
    
    // Verify cleanup
    expect(fileManager.getFile('file-123')).toBeUndefined();
  });
});
```

### Temporary File Management

```typescript
// ✅ Good: Using temporary directories for tests
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';

describe('File Operations', () => {
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'test-'));
  });
  
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  
  it('should create files in temp directory', async () => {
    const filePath = join(tempDir, 'test.txt');
    await writeFile(filePath, 'test content');
    
    const exists = await access(filePath).then(() => true, () => false);
    expect(exists).toBe(true);
  });
});
```

## Error Handling Testing

### Exception Testing

```typescript
// ✅ Good: Testing error conditions
describe('Error Handling', () => {
  it('should handle validation errors', () => {
    expect(() => {
      RoomKeySchema.parse('invalid-key');
    }).toThrow('Room key must contain both letters and numbers');
  });
  
  it('should handle async errors', async () => {
    const failingFunction = async () => {
      throw new Error('Something went wrong');
    };
    
    await expect(failingFunction()).rejects.toThrow('Something went wrong');
  });
});
```

### Error Boundary Testing

```typescript
// ✅ Good: Testing React error boundaries
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
};

it('should catch and display errors', () => {
  const { rerender } = render(
    <ErrorBoundary>
      <ThrowError shouldThrow={false} />
    </ErrorBoundary>
  );
  
  expect(screen.getByText('No error')).toBeInTheDocument();
  
  rerender(
    <ErrorBoundary>
      <ThrowError shouldThrow={true} />
    </ErrorBoundary>
  );
  
  expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
});
```

## Performance Testing

### Memory Leak Testing

```typescript
// ✅ Good: Testing for memory leaks
describe('Memory Management', () => {
  it('should clean up event listeners', () => {
    const roomService = new RoomService();
    const initialListeners = roomService.listenerCount('roomDestroyed');
    
    // Add listeners
    const handler1 = () => {};
    const handler2 = () => {};
    roomService.on('roomDestroyed', handler1);
    roomService.on('roomDestroyed', handler2);
    
    expect(roomService.listenerCount('roomDestroyed')).toBe(initialListeners + 2);
    
    // Clean up
    roomService.destroy();
    expect(roomService.listenerCount('roomDestroyed')).toBe(0);
  });
});
```

### Timeout Testing

```typescript
// ✅ Good: Testing time-sensitive operations
it('should timeout after specified duration', async () => {
  const slowOperation = () => new Promise(resolve => 
    setTimeout(resolve, 2000)
  );
  
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Timeout')), 1000)
  );
  
  await expect(
    Promise.race([slowOperation(), timeoutPromise])
  ).rejects.toThrow('Timeout');
});
```

## Anti-Patterns to Avoid

### ❌ Testing Implementation Details

```typescript
// ❌ Bad: Testing internal state
it('should update internal counter', () => {
  const component = new SomeComponent();
  component.increment();
  expect(component._internalCounter).toBe(1); // Don't test private properties
});

// ✅ Good: Testing behavior
it('should display incremented value', () => {
  render(<Counter />);
  fireEvent.click(screen.getByRole('button', { name: /increment/i }));
  expect(screen.getByText('Count: 1')).toBeInTheDocument();
});
```

### ❌ Overly Complex Test Setup

```typescript
// ❌ Bad: Complex setup that's hard to understand
beforeEach(() => {
  // 50 lines of setup code
  mockA.setup().withReturn(mockB.getResponse()).when(mockC.called());
});

// ✅ Good: Simple, focused setup
beforeEach(() => {
  mockUserService.getUser.mockResolvedValue(createMockUser());
});
```

### ❌ Testing Multiple Things at Once

```typescript
// ❌ Bad: Testing multiple behaviors
it('should handle user login, update state, and redirect', () => {
  // Tests login AND state update AND navigation
});

// ✅ Good: Separate tests for each behavior
it('should authenticate user credentials', () => {
  // Test authentication only
});

it('should update user state after login', () => {
  // Test state update only
});

it('should redirect after successful login', () => {
  // Test navigation only
});
```

### ❌ Brittle Selectors

```typescript
// ❌ Bad: Brittle selectors
screen.getByText('Submit'); // Breaks if text changes
container.querySelector('.btn-primary'); // Breaks if CSS changes

// ✅ Good: Semantic selectors
screen.getByRole('button', { name: /submit/i });
screen.getByLabelText(/username/i);
screen.getByTestId('submit-button');
```

### ❌ Magic Numbers and Strings

```typescript
// ❌ Bad: Magic values
expect(result.length).toBe(5);
await page.waitForTimeout(3000);

// ✅ Good: Named constants
const EXPECTED_MESSAGE_COUNT = 5;
const NETWORK_TIMEOUT = 3000;

expect(result.length).toBe(EXPECTED_MESSAGE_COUNT);
await page.waitForTimeout(NETWORK_TIMEOUT);
```

### ❌ Shared Mutable State

```typescript
// ❌ Bad: Shared mutable state between tests
let sharedUser = { name: 'Test' };

it('should update user name', () => {
  sharedUser.name = 'Updated'; // Affects other tests
});

// ✅ Good: Fresh state for each test
beforeEach(() => {
  user = createFreshUser();
});
```

## Summary

Following these patterns will help ensure our tests are:

- **Reliable**: Tests pass consistently and don't flake
- **Maintainable**: Easy to update when code changes
- **Readable**: Clear intent and easy to understand
- **Fast**: Quick feedback during development
- **Isolated**: Tests don't affect each other

Remember: Good tests are an investment in code quality and developer productivity. Take time to write them well.