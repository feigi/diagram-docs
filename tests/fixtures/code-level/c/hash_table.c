#include "hash_table.h"
#include <stdlib.h>
#include <string.h>

static size_t bucket_index(hash_table_t *t, const char *key) {
    return strlen(key) % t->capacity;
}

static void rehash(hash_table_t *t) {
    /* ... */
}

hash_table_t *hash_create(size_t capacity) { return NULL; }
void hash_insert(hash_table_t *t, const char *key, void *value) { (void)rehash; (void)bucket_index; }
void *hash_lookup(hash_table_t *t, const char *key) { return NULL; }
void hash_destroy(hash_table_t *t) { }
