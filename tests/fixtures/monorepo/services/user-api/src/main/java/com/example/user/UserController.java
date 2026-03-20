package com.example.user;

import com.example.repo.UserRepository;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;

@RestController
public class UserController {
    private final UserRepository repo;

    public UserController(UserRepository repo) {
        this.repo = repo;
    }

    @GetMapping("/users")
    public String getUsers() {
        return repo.findAll().toString();
    }
}
