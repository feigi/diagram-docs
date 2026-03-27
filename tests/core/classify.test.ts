import { describe, it, expect } from "vitest";
import { classifyProject } from "../../src/core/classify.js";
import type { DiscoveredApp } from "../../src/core/discovery.js";

describe("classifyProject", () => {
  describe("C projects", () => {
    it("classifies CMakeLists with add_library as library", () => {
      const result = classifyProject(
        {
          path: "libs/mathlib",
          buildFile: "CMakeLists.txt",
          language: "c",
          analyzerId: "c",
        },
        "tests/fixtures/classify/c-library",
      );
      expect(result).toBe("library");
    });

    it("classifies CMakeLists with add_executable as container", () => {
      const result = classifyProject(
        {
          path: "services/daemon",
          buildFile: "CMakeLists.txt",
          language: "c",
          analyzerId: "c",
        },
        "tests/fixtures/classify/c-executable",
      );
      expect(result).toBe("container");
    });
  });

  describe("Java projects", () => {
    it("classifies pom.xml with jar packaging and no main class as library", () => {
      const result = classifyProject(
        {
          path: "libs/common",
          buildFile: "pom.xml",
          language: "java",
          analyzerId: "java",
        },
        "tests/fixtures/classify/java-library",
      );
      expect(result).toBe("library");
    });

    it("classifies pom.xml with spring-boot-maven-plugin as container", () => {
      const result = classifyProject(
        {
          path: "services/api",
          buildFile: "pom.xml",
          language: "java",
          analyzerId: "java",
        },
        "tests/fixtures/classify/java-spring",
      );
      expect(result).toBe("container");
    });

    it("classifies pom.xml with war packaging as container", () => {
      const result = classifyProject(
        {
          path: "services/web",
          buildFile: "pom.xml",
          language: "java",
          analyzerId: "java",
        },
        "tests/fixtures/classify/java-war",
      );
      expect(result).toBe("container");
    });
  });

  describe("TypeScript projects", () => {
    it("classifies package.json without bin/main/server scripts as library", () => {
      const result = classifyProject(
        {
          path: "libs/utils",
          buildFile: "package.json",
          language: "typescript",
          analyzerId: "typescript",
        },
        "tests/fixtures/classify/ts-library",
      );
      expect(result).toBe("library");
    });

    it("classifies package.json with bin field as container", () => {
      const result = classifyProject(
        {
          path: "services/cli",
          buildFile: "package.json",
          language: "typescript",
          analyzerId: "typescript",
        },
        "tests/fixtures/classify/ts-bin",
      );
      expect(result).toBe("container");
    });

    it("classifies package.json with start script as container", () => {
      const result = classifyProject(
        {
          path: "services/api",
          buildFile: "package.json",
          language: "typescript",
          analyzerId: "typescript",
        },
        "tests/fixtures/classify/ts-server",
      );
      expect(result).toBe("container");
    });
  });

  describe("Python projects", () => {
    it("classifies project without __main__.py or app.py as library", () => {
      const result = classifyProject(
        {
          path: "libs/pyutils",
          buildFile: "setup.py",
          language: "python",
          analyzerId: "python",
        },
        "tests/fixtures/classify/python-library",
      );
      expect(result).toBe("library");
    });

    it("classifies project with __main__.py as container", () => {
      const result = classifyProject(
        {
          path: "services/worker",
          buildFile: "setup.py",
          language: "python",
          analyzerId: "python",
        },
        "tests/fixtures/classify/python-main",
      );
      expect(result).toBe("container");
    });
  });

  describe("config override", () => {
    it("config type overrides inference", () => {
      const result = classifyProject(
        {
          path: "libs/mathlib",
          buildFile: "CMakeLists.txt",
          language: "c",
          analyzerId: "c",
        },
        "tests/fixtures/classify/c-library",
        "container",
      );
      expect(result).toBe("container");
    });
  });

  describe("defaults", () => {
    it("defaults to container when inference is ambiguous", () => {
      const result = classifyProject(
        {
          path: "apps/unknown",
          buildFile: "Makefile",
          language: "c",
          analyzerId: "c",
        },
        "tests/fixtures/classify/c-ambiguous",
      );
      expect(result).toBe("container");
    });
  });
});
