#ifndef HASH_TABLE_H
#define HASH_TABLE_H

#include <stddef.h>

typedef struct hash_entry hash_entry_t;
typedef struct hash_table hash_table_t;

struct hash_entry {
    const char *key;
    void *value;
    hash_entry_t *next;
};

struct hash_table {
    hash_entry_t **entries;
    size_t count;
    size_t capacity;
};

hash_table_t *hash_create(size_t capacity);
void hash_insert(hash_table_t *t, const char *key, void *value);
void *hash_lookup(hash_table_t *t, const char *key);
void hash_destroy(hash_table_t *t);

#endif
