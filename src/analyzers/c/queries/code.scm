(struct_specifier
  name: (type_identifier) @struct.name
  body: (field_declaration_list)) @struct.decl

(type_definition
  declarator: (type_identifier) @typedef.name) @typedef.decl

(function_definition
  (storage_class_specifier)? @fn.storage
  declarator: (function_declarator
    declarator: (identifier) @fn.name)) @fn.decl

(function_definition
  (storage_class_specifier)? @fn.storage
  declarator: (pointer_declarator
    declarator: (function_declarator
      declarator: (identifier) @fn.name))) @fn.decl

(declaration
  declarator: (function_declarator
    declarator: (identifier) @decl.name)) @decl.fn

(declaration
  declarator: (pointer_declarator
    declarator: (function_declarator
      declarator: (identifier) @decl.name))) @decl.fn
