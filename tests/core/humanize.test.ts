import { describe, it, expect } from "vitest";
import { humanizeName, lastSegment, inferTechnology } from "../../src/core/humanize.js";

describe("humanizeName", () => {
  it("converts kebab-case to Title Case", () => {
    expect(humanizeName("user-api")).toBe("User Api");
  });

  it("converts snake_case to Title Case", () => {
    expect(humanizeName("order_service")).toBe("Order Service");
  });

  it("extracts last segment from dot-separated names", () => {
    expect(humanizeName("com.example.user")).toBe("User");
  });

  it("handles camelCase", () => {
    expect(humanizeName("userController")).toBe("User Controller");
  });

  it("handles single word", () => {
    expect(humanizeName("orders")).toBe("Orders");
  });

  it("handles empty string", () => {
    expect(humanizeName("")).toBe("");
  });
});

describe("lastSegment", () => {
  it("extracts from dot-separated path", () => {
    expect(lastSegment("com.example.user")).toBe("user");
  });

  it("extracts from slash-separated path", () => {
    expect(lastSegment("services/user-api")).toBe("user-api");
  });

  it("returns input when no separator", () => {
    expect(lastSegment("orders")).toBe("orders");
  });
});

describe("inferTechnology", () => {
  it("detects Spring Boot from dependencies", () => {
    expect(
      inferTechnology("java", ["spring-boot-starter-web"]),
    ).toBe("Java / Spring Boot");
  });

  it("detects FastAPI from dependencies", () => {
    expect(inferTechnology("python", ["fastapi", "uvicorn"])).toBe(
      "Python / FastAPI",
    );
  });

  it("detects Flask from dependencies", () => {
    expect(inferTechnology("python", ["flask"])).toBe("Python / Flask");
  });

  it("returns language-only when no framework detected", () => {
    expect(inferTechnology("c", ["libm"])).toBe("C");
  });

  it("is case-insensitive for dependency names", () => {
    expect(inferTechnology("python", ["FastAPI"])).toBe("Python / FastAPI");
  });
});
