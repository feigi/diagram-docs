import type { RawStructure, Component } from "../../../src/analyzers/types.js";
import { configSchema, type Config } from "../../../src/config/schema.js";

export const codeFixture: RawStructure = {
  applications: [
    {
      id: "api",
      name: "api",
      language: "java",
      path: "/tmp/api",
      modules: [
        {
          id: "users",
          path: "/tmp/api/users",
          name: "users",
          files: ["UserService.java"],
          exports: [],
          imports: [],
          metadata: {},
          codeElements: [
            {
              id: "UserService",
              name: "UserService",
              kind: "class",
              visibility: "public",
              references: [{ targetName: "Auditable", kind: "implements" }],
              location: { file: "UserService.java", line: 1 },
            },
            {
              id: "Auditable",
              name: "Auditable",
              kind: "interface",
              visibility: "public",
              location: { file: "UserService.java", line: 1 },
            },
          ],
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ],
} as any;

export const codeFixtureComponents: Component[] = [
  {
    id: "users",
    containerId: "api",
    name: "users",
    description: "",
    technology: "",
    moduleIds: ["users"],
  } as any,
];

export function makeConfig(
  codeOn: boolean,
  overrides: Partial<{
    includePrivate: boolean;
    includeMembers: boolean;
    minElements: number;
  }> = {},
): Config {
  return configSchema.parse({
    system: { name: "s", description: "" },
    levels: { context: true, container: true, component: true, code: codeOn },
    code: {
      includePrivate: overrides.includePrivate ?? false,
      includeMembers: overrides.includeMembers ?? true,
      minElements: overrides.minElements ?? 2,
    },
    abstraction: { granularity: "balanced", excludePatterns: [] },
  });
}

/**
 * Two components in the same container where B defines `Logger` and A
 * references it — exercises cross-component same-container resolution.
 */
export const crossComponentFixture: RawStructure = {
  applications: [
    {
      id: "api",
      name: "api",
      language: "java",
      path: "/tmp/api",
      modules: [
        {
          id: "auth",
          path: "/tmp/api/auth",
          name: "auth",
          files: ["AuthService.java"],
          exports: [],
          imports: [],
          metadata: {},
          codeElements: [
            {
              id: "AuthService",
              name: "AuthService",
              kind: "class",
              visibility: "public",
              references: [{ targetName: "Logger", kind: "uses" }],
              location: { file: "AuthService.java", line: 1 },
            },
            {
              id: "AuthHelper",
              name: "AuthHelper",
              kind: "class",
              visibility: "public",
              location: { file: "AuthService.java", line: 10 },
            },
          ],
        },
        {
          id: "logging",
          path: "/tmp/api/logging",
          name: "logging",
          files: ["Logger.java"],
          exports: [],
          imports: [],
          metadata: {},
          codeElements: [
            {
              id: "Logger",
              name: "Logger",
              kind: "class",
              visibility: "public",
              location: { file: "Logger.java", line: 1 },
            },
            {
              id: "LogWriter",
              name: "LogWriter",
              kind: "class",
              visibility: "public",
              location: { file: "Logger.java", line: 20 },
            },
          ],
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ],
} as any;

export const crossComponentComponents: Component[] = [
  {
    id: "auth",
    containerId: "api",
    name: "auth",
    description: "",
    technology: "",
    moduleIds: ["auth"],
  } as any,
  {
    id: "logging",
    containerId: "api",
    name: "logging",
    description: "",
    technology: "",
    moduleIds: ["logging"],
  } as any,
];

/**
 * Two containers. Component `user-api.users` references `Logger`, which
 * exists only in `order-api.logging` — must NOT resolve (cross-container
 * refs are intentionally dropped).
 */
export const crossContainerFixture: RawStructure = {
  applications: [
    {
      id: "user-api",
      name: "user-api",
      language: "java",
      path: "/tmp/user-api",
      modules: [
        {
          id: "users",
          path: "/tmp/user-api/users",
          name: "users",
          files: ["UserService.java"],
          exports: [],
          imports: [],
          metadata: {},
          codeElements: [
            {
              id: "UserService",
              name: "UserService",
              kind: "class",
              visibility: "public",
              references: [{ targetName: "Logger", kind: "uses" }],
              location: { file: "UserService.java", line: 1 },
            },
            {
              id: "UserRepo",
              name: "UserRepo",
              kind: "interface",
              visibility: "public",
              location: { file: "UserService.java", line: 20 },
            },
          ],
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
    {
      id: "order-api",
      name: "order-api",
      language: "java",
      path: "/tmp/order-api",
      modules: [
        {
          id: "logging",
          path: "/tmp/order-api/logging",
          name: "logging",
          files: ["Logger.java"],
          exports: [],
          imports: [],
          metadata: {},
          codeElements: [
            {
              id: "Logger",
              name: "Logger",
              kind: "class",
              visibility: "public",
              location: { file: "Logger.java", line: 1 },
            },
            {
              id: "LogConfig",
              name: "LogConfig",
              kind: "class",
              visibility: "public",
              location: { file: "Logger.java", line: 10 },
            },
          ],
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ],
} as any;

export const crossContainerComponents: Component[] = [
  {
    id: "users",
    containerId: "user-api",
    name: "users",
    description: "",
    technology: "",
    moduleIds: ["users"],
  } as any,
  {
    id: "logging",
    containerId: "order-api",
    name: "logging",
    description: "",
    technology: "",
    moduleIds: ["logging"],
  } as any,
];

/**
 * Mixed visibility and member visibility — exercises includePrivate toggle.
 */
export const mixedVisibilityFixture: RawStructure = {
  applications: [
    {
      id: "api",
      name: "api",
      language: "java",
      path: "/tmp/api",
      modules: [
        {
          id: "users",
          path: "/tmp/api/users",
          name: "users",
          files: ["UserService.java"],
          exports: [],
          imports: [],
          metadata: {},
          codeElements: [
            {
              id: "UserService",
              name: "UserService",
              kind: "class",
              visibility: "public",
              members: [
                { name: "getUser", kind: "method", visibility: "public" },
                { name: "_cache", kind: "field", visibility: "private" },
              ],
              location: { file: "UserService.java", line: 1 },
            },
            {
              id: "Helper",
              name: "Helper",
              kind: "class",
              visibility: "public",
              location: { file: "UserService.java", line: 30 },
            },
            {
              id: "InternalUtil",
              name: "InternalUtil",
              kind: "class",
              visibility: "private",
              location: { file: "UserService.java", line: 50 },
            },
          ],
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ],
} as any;
