import type { ObjectProperty, PropertyKind, WorkflowObject } from '../api/objects';

/**
 * The workspace's objects, written as TypeScript the editor can check against.
 *
 * A parameter that names an object is annotated with that object's name, and a name
 * the language service cannot resolve is an error on every function that takes one.
 * So the definitions have to be declared, and they have to be declared from the same
 * catalogue the picker offers — anything else and the editor would be checking code
 * against a shape the workspace does not hold.
 *
 * Written as interfaces in a global declaration file rather than a module: a
 * function's source is a module of its own, and an ambient interface is what is
 * visible from inside one without an import nobody could write.
 */
export function objectTypes(objects: WorkflowObject[]): string {
  const names = new Map(objects.map((held) => [held.id, held.name]));
  const usable = objects.filter((held) => IDENTIFIER.test(held.name));

  const declarations = usable.map((held) => {
    const fields = held.properties.map((property) => `  ${field(property)}: ${typeOf(property, names)};`);
    return [
      `/** ${held.description ?? `${held.name}, as this workspace defines it.`} */`,
      `interface ${held.name} {`,
      ...fields,
      '}',
    ].join('\n');
  });

  return declarations.join('\n\n');
}

/**
 * A name TypeScript can declare an interface by.
 *
 * An object whose name is not one is left out rather than mangled: a parameter could
 * not be annotated with a mangled name either, so inventing one would only mean the
 * editor and the picker disagreeing about what the object is called.
 */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A property's name, quoted when it is not something that can be written plainly. */
function field(property: ObjectProperty): string {
  return IDENTIFIER.test(property.name) ? property.name : JSON.stringify(property.name);
}

/** What one property is, in TypeScript. */
function typeOf(property: ObjectProperty, names: Map<string, string>): string {
  if (property.kind === 'ARRAY') {
    // An array of objects points at one; an array of scalars says which scalar.
    if (property.refObjectId != null) return `${referenced(property.refObjectId, names)}[]`;
    return property.elementKind == null ? 'unknown[]' : `${scalar(property.elementKind)}[]`;
  }
  if (property.kind === 'OBJECT') return referenced(property.refObjectId, names);
  return scalar(property.kind);
}

/**
 * The object a property points at.
 *
 * `Record<string, unknown>` when it points at nothing that still exists, or at one
 * whose name is not declarable. That is the honest answer — the field is there and
 * its shape is not known here — and it keeps the surrounding interface valid, which
 * a dangling name would not.
 */
function referenced(objectId: string | null | undefined, names: Map<string, string>): string {
  const name = objectId == null ? undefined : names.get(objectId);
  return name !== undefined && IDENTIFIER.test(name) ? name : 'Record<string, unknown>';
}

function scalar(kind: PropertyKind): string {
  switch (kind) {
    case 'STRING':
      return 'string';
    case 'NUMBER':
      return 'number';
    case 'BOOLEAN':
      return 'boolean';
    default:
      return 'unknown';
  }
}
