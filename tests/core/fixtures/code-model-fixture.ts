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

export function makeConfig(codeOn: boolean): Config {
  return configSchema.parse({
    system: { name: "s", description: "" },
    levels: { context: true, container: true, component: true, code: codeOn },
    code: { includePrivate: false, includeMembers: true, minElements: 2 },
    abstraction: { granularity: "balanced", excludePatterns: [] },
  });
}
