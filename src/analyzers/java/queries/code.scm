(class_declaration
  name: (identifier) @class.name) @class.decl

(interface_declaration
  name: (identifier) @interface.name) @interface.decl

(enum_declaration
  name: (identifier) @enum.name) @enum.decl

;; Methods inside classes or interfaces (visibility filtered downstream via inferVisibility)
(method_declaration
  (modifiers)? @method.modifiers
  type: (_) @method.return
  name: (identifier) @method.name
  parameters: (formal_parameters) @method.params) @method.decl

(field_declaration
  (modifiers)? @field.modifiers
  type: (_) @field.type
  declarator: (variable_declarator name: (identifier) @field.name)) @field.decl
