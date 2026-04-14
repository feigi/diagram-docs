export interface Auditable {
  getAuditLog(): string;
}

export type Id = string;

export class User {
  constructor(private readonly name: string) {}
  getName(): string {
    return this.name;
  }
}

export class UserService implements Auditable {
  private users: User[] = [];
  public findByName(name: string): User | undefined {
    return undefined;
  }
  getAuditLog(): string {
    return "";
  }
}

export function formatUser(u: User): string {
  return u.getName();
}
