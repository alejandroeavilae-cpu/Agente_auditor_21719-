// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Valor JSON admitido en la bitácora. Se restringe a tipos con representación
 * única para que el hash de una entrada sea reproducible por cualquier verificador.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Serializa un valor JSON de forma canónica: claves de objetos ordenadas
 * lexicográficamente (por punto de código), sin espacios y sin valores ambiguos.
 *
 * Por qué existe: el hash encadenado solo es verificable de forma independiente
 * si dos implementaciones distintas producen exactamente los mismos bytes para
 * la misma entrada. `JSON.stringify` no garantiza el orden de claves.
 *
 * Rechaza números no finitos (NaN, Infinity) y `undefined`, porque no tienen
 * representación JSON estándar y romperían la reproducibilidad.
 *
 * @throws {TypeError} si el valor contiene tipos no representables.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('La bitácora no admite números no finitos (NaN o Infinity).');
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      }
      const keys = Object.keys(value).sort();
      const parts = keys.map((key) => {
        const item = value[key];
        if (item === undefined) {
          throw new TypeError(`La clave "${key}" tiene valor undefined, que no es JSON válido.`);
        }
        return `${JSON.stringify(key)}:${canonicalJson(item)}`;
      });
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`Tipo no admitido en la bitácora: ${typeof value}`);
  }
}
