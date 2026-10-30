// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Roles y combinaciones prohibidas, copiados de `packages/identity/src/rbac.ts` (D-79).
 *
 * El paquete de identidad usa `node:crypto` y no se puede empaquetar para el navegador, por
 * eso se duplica esta tabla pequeña. La prueba `test/roles.test.ts` compara ambas copias y
 * falla si divergen. La API sigue siendo la que decide (`400 invalid_roles`): esta tabla solo
 * sirve para explicar las reglas antes de enviar.
 */

export const ROLES = ['org_admin', 'audit_lead', 'auditor', 'legal_reviewer', 'remediation_owner', 'reader'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  org_admin: 'Administrador de organización',
  audit_lead: 'Responsable de auditoría',
  auditor: 'Auditor',
  legal_reviewer: 'Revisor jurídico',
  remediation_owner: 'Responsable de remediación',
  reader: 'Lector',
};

/** Descripción breve de cada rol para ayudar a elegir. */
export const ROLE_HINTS: Readonly<Record<Role, string>> = {
  org_admin: 'Gestiona usuarios, ve el registro de accesos y exporta la bitácora. No ejecuta auditorías.',
  audit_lead: 'Autoriza y ejecuta auditorías (fases posteriores).',
  auditor: 'Revisa hallazgos (fases posteriores).',
  legal_reviewer: 'Decide la conformidad legal de los controles (fases posteriores).',
  remediation_owner: 'Gestiona la remediación (fases posteriores).',
  reader: 'Solo lectura de informes (fases posteriores).',
};

export const FORBIDDEN_ROLE_PAIRS: readonly (readonly [Role, Role])[] = [
  ['org_admin', 'audit_lead'],
  ['org_admin', 'auditor'],
  ['org_admin', 'legal_reviewer'],
];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function roleLabel(value: string): string {
  return isRole(value) ? ROLE_LABELS[value] : value;
}

/** Combinaciones prohibidas presentes en una selección, como texto para mostrar. */
export function forbiddenCombinations(roles: readonly string[]): string[] {
  return FORBIDDEN_ROLE_PAIRS.filter(([a, b]) => roles.includes(a) && roles.includes(b)).map(
    ([a, b]) => `"${ROLE_LABELS[a]}" no puede combinarse con "${ROLE_LABELS[b]}".`,
  );
}
