# Agent Guidelines for OpenCode Remote

This document provides guidelines for agents working on this codebase.

## Project Overview

OpenCode Remote is a self-hosted remote control system for OpenCode with:
- `apps/gateway`: Fastify-based companion gateway (Node.js/TypeScript)
- `apps/mobile`: Expo React Native client for iOS/Android
- `packages/shared`: Shared Zod schemas and contracts

## Build Commands

### Root Commands
```bash
npm run build           # Build all workspaces (shared, gateway, typecheck mobile)
npm run typecheck       # Type-check all workspaces
npm run test            # Run gateway tests
npm run dev:gateway    # Start gateway in development mode
npm run dev:mobile     # Start Expo dev server for mobile
```

### Gateway Commands
```bash
cd apps/gateway
npm run dev             # Development with tsx watch
npm run build           # Compile TypeScript
npm run typecheck       # Type-check only
npm run test            # Run vitest tests
```

### Mobile Commands
```bash
cd apps/mobile
npm run dev             # Start Expo
npm run typecheck       # Type-check
```

### Running a Single Test
```bash
cd apps/gateway
npx vitest run test/your-test-file.test.ts
# Or with watch mode:
npx vitest test/your-test-file.test.ts
```

## Code Style Guidelines

### TypeScript Configuration
- Strict mode is enabled globally (`tsconfig.base.json`)
- Target: ES2022, Module: NodeNext
- Use explicit type annotations for function parameters and return types
- Zod for runtime validation and schema definition

### Imports
- Use path aliases: `@opencode-remote/shared` for shared package
- Order: external libraries → internal packages → relative paths
- Include file extensions for local imports (`.js` for TS files in NodeNext)

Example:
```typescript
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { SessionSummary, StreamEvent } from "@opencode-remote/shared"
import { getSessions, openStreamSocket } from "../lib/api"
import { useInboxStore } from "../state/inbox-store"
```

### Naming Conventions
- **Files**: kebab-case for most files (`terminal-manager.ts`), PascalCase for components (`SessionsScreen.tsx`)
- **Functions**: camelCase, use verb prefixes for actions (`getSessions`, `openStreamSocket`)
- **Types/Interfaces**: PascalCase (`type Props = { ... }`)
- **Constants**: SCREAMING_SNAKE_CASE for config values
- **React Components**: PascalCase, named exports preferred

### React/React Native Patterns
- Use functional components with hooks
- Prefer `useMemo` and `useCallback` for expensive computations or stable references
- Use TanStack Query (`useQuery`) for server state
- Use Zustand for client state management
- Define component props with explicit `type Props = { ... }` interface

Example:
```typescript
type Props = {
  session: AuthSession
  onRefreshSession: (tokens: AuthTokens) => Promise<void>
  onOpenSession: (sessionId: string) => void
}

export function SessionsScreen({ session, onRefreshSession, onOpenSession }: Props) {
  // ...
}
```

### Error Handling
- Use try/catch with specific error handling
- Throw descriptive errors for validation failures
- Handle async operations with proper error states in UI
- Log errors appropriately using the framework's logging (e.g., `app.log.error` in Fastify)

### State Management
- Server state: TanStack Query (`useQuery`, `useMutation`)
- Client state: Zustand stores
- Component state: `useState`, `useReducer`
- Derived state: `useMemo`

### Styling (React Native)
- Use `StyleSheet.create()` for styles
- Use numeric color values (e.g., `#020617`) rather than named colors
- Follow the existing color palette in stylesheets
- Group related styles together

### Zod Schemas
- Define schemas in `packages/shared/src/index.ts`
- Use discriminated unions for event types
- Export both schema and inferred type

Example:
```typescript
export const streamEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session.snapshot"),
    payload: sessionSummarySchema,
  }),
  // ...
])
export type StreamEvent = z.infer<typeof streamEventSchema>
```

### WebSocket Handling
- Always handle `onclose` events to clean up resources
- Implement reconnection logic for critical connections
- Send JSON.stringify for messages, parse incoming messages

### Testing
- Place tests in `test/*.test.ts` (gateway) following vitest conventions
- Use descriptive test names
- Test one thing per test case
- Mock external dependencies

### File Organization
```
apps/gateway/
├── src/
│   ├── index.ts        # Entry point
│   ├── app.ts          # Fastify app builder
│   ├── config.ts       # Configuration
│   ├── auth.ts         # Authentication
│   └── *.ts           # Other modules
└── test/
    └── *.test.ts      # Unit tests

apps/mobile/
├── src/
│   ├── screens/       # Screen components
│   ├── components/    # Reusable components
│   ├── lib/           # Utilities and API clients
│   └── state/         # Zustand stores
└── App.tsx           # Root component

packages/shared/
└── src/
    └── index.ts       # Zod schemas
```

### Git Conventions
- Write descriptive commit messages
- Keep changes focused and atomic
- Test before committing

### Security Considerations
- Never log sensitive data (tokens, passwords)
- Use secure storage (expo-secure-store) for auth tokens
- Validate all inputs with Zod schemas
- Handle WebSocket connections securely with authentication headers
