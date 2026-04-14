;; Classes
(class_declaration
  name: (identifier) @class.name) @class.decl

;; Interfaces
(interface_declaration
  name: (identifier) @interface.name) @interface.decl

;; Enums
(enum_declaration
  name: (identifier) @enum.name) @enum.decl

;; Public methods inside classes or interfaces
(method_declaration
  (modifiers)? @method.modifiers
  type: (_) @method.return
  name: (identifier) @method.name
  parameters: (formal_parameters) @method.params) @method.decl

;; Fields
(field_declaration
  (modifiers)? @field.modifiers
  type: (_) @field.type
  declarator: (variable_declarator name: (identifier) @field.name)) @field.decl
