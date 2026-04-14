(struct_specifier
  name: (type_identifier) @struct.name
  body: (field_declaration_list)) @struct.decl

(type_definition
  declarator: (type_identifier) @typedef.name) @typedef.decl

(function_definition) @fn.decl

(declaration
  declarator: [
    (function_declarator)
    (pointer_declarator)
  ]) @decl.fn
