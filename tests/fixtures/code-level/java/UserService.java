package com.example.users;

import java.util.List;
import java.io.Serializable;

public interface Auditable {
    String getAuditLog();
}

public class User implements Serializable {
    private String name;
    public String getName() { return name; }
}

public class UserService implements Auditable {
    private final List<User> users;

    public UserService(List<User> users) {
        this.users = users;
    }

    public User findByName(String name) { return null; }

    public String getAuditLog() { return ""; }
}

enum Role { ADMIN, USER }
