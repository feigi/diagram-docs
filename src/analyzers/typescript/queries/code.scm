;; Classes
(class_declaration
  name: (type_identifier) @class.name) @class.decl

;; Interfaces
(interface_declaration
  name: (type_identifier) @interface.name) @interface.decl

;; Type aliases
(type_alias_declaration
  name: (type_identifier) @type.name) @type.decl

;; Module-level function declarations
(function_declaration
  name: (identifier) @fn.name) @fn.decl
