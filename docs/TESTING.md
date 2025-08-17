# Testing Guide

This document provides comprehensive guidance on testing practices, patterns, and workflows for the Cloud Clipboard project.

## Table of Contents

- [Overview](#overview)
- [Test Architecture](#test-architecture)
- [Testing Commands](#testing-commands)
- [Unit Testing](#unit-testing)
- [Integration Testing](#integration-testing)
- [End-to-End Testing](#end-to-end-testing)
- [Coverage Requirements](#coverage-requirements)
- [Best Practices](#best-practices)
- [CI/CD Pipeline](#cicd-pipeline)
- [Troubleshooting](#troubleshooting)

## Overview

Our testing strategy employs a three-layer approach:

1. **Unit Tests** - Test individual functions, classes, and components in isolation
2. **Integration Tests** - Test interactions between different modules and services
3. **End-to-End Tests** - Test complete user workflows across the entire application

### Test Stack

- **Unit Testing**: Bun Test (server/shared) + Vitest (client)
- **Integration Testing**: Bun Test + Supertest + Socket.IO Client
- **E2E Testing**: Playwright
- **Mocking**: Built-in test framework mocks + Manual mocks
- **Coverage**: Built-in coverage tools with custom reporting

## Test Architecture

```
cloud-clipboard/
├── shared/
│   ├── src/
│   │   ├── *.test.ts          # Unit tests for schemas and utilities
│   │   └── test-helpers/      # Shared test utilities
│   └── bun.config.ts          # Bun test configuration
├── server/
│   ├── src/
│   │   ├── **/*.test.ts       # Unit tests
│   │   ├── integration.test.ts # Integration tests
│   │   └── test-helpers/      # Server test utilities
│   └── bun.config.ts          # Bun test configuration
├── client/
│   ├── src/
│   │   ├── **/*.test.{ts,tsx} # Unit tests
│   │   └── test/
│   │       └── setup.ts       # Test setup and global mocks
│   ├── e2e/
│   │   └── *.spec.ts          # End-to-end tests
│   ├── vitest.config.ts       # Vitest configuration
│   └── playwright.config.ts   # Playwright configuration
└── .github/workflows/
    └── test.yml               # CI/CD test pipeline
```

## Testing Commands

### Run All Tests

```bash
# Run all tests across all packages
bun run test

# Run tests with coverage
bun run test:coverage

# Watch mode for development
bun run test:watch
```

### Package-Specific Tests

```bash
# Shared package
bun run shared:test
bun run shared:test:coverage
bun run shared:test:watch

# Server package
bun run server:test
bun run server:test:coverage
bun run server:test:integration

# Client package  
bun run client:test
bun run client:test:coverage
bun run client:test:e2e
```

### Specialized Tests

```bash
# Integration tests only
bun run test:integration

# End-to-end tests only
bun run test:e2e

# Lint and type checking
bun run lint
bun run type-check
```

## Unit Testing

### Shared Package Testing

Tests for schemas, utilities, and type definitions:

```typescript
// shared/src/schemas.test.ts
import { describe, it, expect } from 'bun:test';
import { RoomKeySchema } from './schemas';

describe('RoomKeySchema', () => {
  it('should accept valid room keys', () => {
    const validKeys = ['room123', 'test_room-42'];
    validKeys.forEach(key => {
      expect(() => RoomKeySchema.parse(key)).not.toThrow();
    });
  });

  it('should reject invalid room keys', () => {
    expect(() => RoomKeySchema.parse('abc')).toThrow();
  });
});
```

### Server Testing

Tests for services, routes, and middleware:

```typescript
// server/src/services/RoomService.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { RoomService } from './RoomService';

describe('RoomService', () => {
  let roomService: RoomService;

  beforeEach(() => {
    roomService = new RoomService();
  });

  afterEach(() => {
    roomService.destroy();
  });

  it('should create a new room', () => {
    const room = roomService.createRoom('testroom123');
    expect(room.key).toBe('testroom123');
  });
});
```

### Client Testing

Tests for components, hooks, and utilities:

```typescript
// client/src/components/ui/button.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button Component', () => {
  it('should render with default variant', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should handle click events', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    
    render(<Button onClick={handleClick}>Click me</Button>);
    await user.click(screen.getByRole('button'));
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```

## Integration Testing

Integration tests verify interactions between different parts of the system:

```typescript
// server/src/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import request from 'supertest';
import { io as Client } from 'socket.io-client';

describe('Integration Tests', () => {
  // Test server setup, WebSocket connections, API endpoints
  
  it('should handle WebSocket room join and message flow', async () => {
    // Test complete WebSocket flow
    const client = Client('http://localhost:3999');
    
    client.emit('joinRoom', {
      type: 'join_room',
      roomKey: 'test123',
      user: { name: 'TestUser', deviceType: 'desktop' }
    });
    
    // Verify user list, message broadcasting, etc.
  });
});
```

## End-to-End Testing

E2E tests verify complete user workflows using Playwright:

```typescript
// client/e2e/basic-functionality.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Room Functionality', () => {
  test('should join room and send messages', async ({ page, context }) => {
    const roomKey = `test-room-${Date.now()}`;
    
    // Join room
    await page.goto('/');
    await page.getByPlaceholder('Enter room key').fill(roomKey);
    await page.getByPlaceholder('Enter your name').fill('Test User');
    await page.getByRole('button', { name: /join room/i }).click();
    
    // Send message
    await page.getByPlaceholder('Type a message...').fill('Hello!');
    await page.getByRole('button', { name: /send/i }).click();
    
    // Verify message appears
    await expect(page.getByText('Hello!')).toBeVisible();
  });
});
```

### E2E Test Categories

1. **Smoke Tests** - Basic functionality and critical paths
2. **User Journey Tests** - Complete user workflows
3. **Cross-browser Tests** - Compatibility testing
4. **Mobile Tests** - Mobile device testing
5. **Performance Tests** - Basic performance validation

## Coverage Requirements

### Coverage Thresholds

| Package | Functions | Lines | Statements | Branches |
|---------|-----------|-------|------------|----------|
| Shared  | 80%       | 80%   | 80%        | 70%      |
| Server  | 75%       | 75%   | 75%        | 65%      |
| Client  | 70%       | 70%   | 70%        | 60%      |

### Coverage Reports

Coverage reports are generated in multiple formats:

- **Text**: Console output during test runs
- **HTML**: Interactive reports in `./coverage/` directories
- **JSON**: Machine-readable data for CI/CD
- **LCOV**: For external tools and integrations

### Viewing Coverage

```bash
# Generate and view coverage
bun run test:coverage

# Open HTML reports
open shared/coverage/index.html
open server/coverage/index.html  
open client/coverage/index.html
```

## Best Practices

### Test Organization

1. **Group Related Tests**: Use `describe` blocks to group related functionality
2. **Descriptive Names**: Use clear, descriptive test names that explain what is being tested
3. **One Assertion Per Test**: Focus each test on a single behavior or outcome
4. **Setup and Teardown**: Use `beforeEach`/`afterEach` for consistent test isolation

### Test Data Management

```typescript
// Good: Use factories or builders for test data
const createMockUser = (overrides = {}) => ({
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'TestUser',
  isOnline: true,
  lastSeen: new Date(),
  deviceType: 'desktop',
  ...overrides,
});

// Good: Use meaningful test data
const validRoomKeys = ['room123', 'test_room-42', 'MyRoom2024'];
const invalidRoomKeys = ['', 'abc', '123', 'room key with spaces'];
```

### Mocking Guidelines

1. **Mock External Dependencies**: Mock APIs, databases, file systems
2. **Don't Mock What You're Testing**: Test your actual code, not mocks
3. **Use Minimal Mocks**: Only mock what's necessary for the test
4. **Reset Mocks**: Clear mock state between tests

```typescript
// Client test setup with mocks
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  })),
}));
```

### Async Testing

```typescript
// Good: Proper async/await usage
it('should handle async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBe(expectedValue);
});

// Good: Testing promises
it('should reject with error', async () => {
  await expect(failingFunction()).rejects.toThrow('Expected error');
});
```

### Error Testing

```typescript
// Test both success and failure cases
it('should handle file upload errors', async () => {
  mockFs.writeFile.mockRejectedValue(new Error('Disk full'));
  
  const result = await fileManager.uploadFile(mockFile);
  
  expect(result.success).toBe(false);
  expect(result.error).toContain('Disk full');
});
```

## CI/CD Pipeline

### GitHub Actions Workflow

Our CI/CD pipeline runs comprehensive tests on every push and pull request:

1. **Lint and Type Check** - Code quality validation
2. **Unit Tests** - Fast feedback on individual components
3. **Integration Tests** - Service interaction validation
4. **E2E Tests** - Complete workflow validation
5. **Coverage Reports** - Coverage tracking and thresholds
6. **Security Scans** - Dependency and code security
7. **Build Tests** - Production build validation

### Test Matrix

Tests run across multiple environments:

- **Operating Systems**: Ubuntu, Windows, macOS
- **Node.js Versions**: Latest LTS
- **Browsers**: Chrome, Firefox, Safari, Edge (for E2E)
- **Devices**: Desktop and Mobile viewports

### Failure Handling

- **Automatic Retries**: E2E tests retry up to 2 times on failure
- **Artifact Collection**: Screenshots, videos, and reports collected on failure
- **Parallel Execution**: Tests run in parallel for faster feedback
- **Fail Fast**: Critical failures stop the pipeline early

## Troubleshooting

### Common Issues

#### Test Timeouts

```bash
# Increase timeout for slow tests
test('slow operation', async () => {
  // Test implementation
}, { timeout: 30000 }); // 30 second timeout
```

#### Mock Issues

```typescript
// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Check mock calls
expect(mockFunction).toHaveBeenCalledWith(expectedArgs);
expect(mockFunction).toHaveBeenCalledTimes(1);
```

#### Coverage Issues

- **Missing Coverage**: Ensure all code paths are tested
- **False Positives**: Exclude test files and configurations from coverage
- **Threshold Failures**: Adjust thresholds in config files if needed

#### E2E Test Issues

```typescript
// Wait for elements properly
await expect(page.getByText('Loading...')).toBeHidden();
await expect(page.getByText('Data loaded')).toBeVisible();

// Handle dynamic content
await page.waitForFunction(() => 
  document.querySelector('[data-testid="message-list"]')?.children.length > 0
);
```

### Debug Mode

```bash
# Run tests in debug mode
bun test --inspect-brk

# Run E2E tests with browser visible
bunx playwright test --headed --debug
```

### Performance

```bash
# Run tests with performance monitoring
bun test --reporter=verbose

# Profile test execution
bun test --coverage --reporter=verbose
```

## Testing Checklist

Before submitting code, ensure:

- [ ] All tests pass locally
- [ ] New code has corresponding tests
- [ ] Coverage thresholds are met
- [ ] Integration tests cover service interactions
- [ ] E2E tests cover critical user paths
- [ ] Tests are fast and reliable
- [ ] Mocks are used appropriately
- [ ] Test data is realistic and varied
- [ ] Error cases are tested
- [ ] Tests are well-documented

## Resources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Library Best Practices](https://testing-library.com/docs/guiding-principles)
- [Jest Mocking Patterns](https://jestjs.io/docs/mock-functions)

---

This testing guide is a living document. Please update it as our testing practices evolve and improve.