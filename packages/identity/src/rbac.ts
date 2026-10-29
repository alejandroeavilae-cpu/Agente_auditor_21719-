// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Roles y permisos (RBAC) de los usuarios de una organización (D-79).
 *
 * Los roles son fijos y se definen aquí, revisables y con pruebas. El séptimo rol base de
 * `06-modelo-de-datos.md` §7.5, el operador de plataforma, no es un rol web: opera solo
 * con la CLI en el servidor (D-76).
 */

export const ROLES = ['org_admin', 'audit_lead', 'auditor', 'legal_reviewer', 'remediation_owner', 'reader'] as const;
export type Role = (typeof ROLES)[number];

/** Nombres visibles (español) de cada rol. */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  org_admin: 'Administrador de organización',
  audit_lead: 'Responsable de auditoría',
  auditor: 'Auditor',
  legal_reviewer: 'Revisor jurídico',
  remediation_owner: 'Responsable de remediación',
  reader: 'Lector',
};

/**
 * Permisos. Los de fases futuras se declaran ya para que la matriz quede fijada y probada
 * desde ahora; ningún endpoint de 2B los usa.
 */
export const PERMISSIONS = [
  // 2B
  'users.read',
  'users.manage',
  // Fase 3+
  'audits.authorize',
  'audits.run',
  'findings.review',
  'controls.legal_decision',
  'remediation.manage',
  'reports.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Matriz rol → permisos, según los alcances de `06-modelo-de-datos.md` §7.5. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  // Usuarios, roles y configuración institucional; no ejecuta auditorías (separación de funciones).
  org_admin: ['users.read', 'users.manage', 'reports.read'],
  audit_lead: ['audits.authorize', 'audits.run', 'findings.review', 'reports.read'],
  auditor: ['findings.review', 'reports.read'],
  // Único rol que fija "Conforme"/"No conforme" en obligaciones legales (D-06).
  legal_reviewer: ['controls.legal_decision', 'findings.review', 'reports.read'],
  remediation_owner: ['remediation.manage', 'reports.read'],
  reader: ['reports.read'],
};

/** Roles con MFA obligatorio (D-77; `09-seguridad.md` §10.3). */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(['org_admin', 'audit_lead', 'legal_reviewer']);

/**
 * Combinaciones prohibidas por separación de funciones (D-79). Derivadas de §7.5: el
 * administrador "no ejecuta auditorías por sí solo" y la decisión jurídica no puede
 * concentrarse en quien administra usuarios. [DECISIÓN]
 */
export const FORBIDDEN_ROLE_PAIRS: readonly (readonly [Role, Role])[] = [
  ['org_admin', 'audit_lead'],
  ['org_admin', 'auditor'],
  ['org_admin', 'legal_reviewer'],
];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Permisos efectivos de un conjunto de roles. */
export function permissionsOf(roles: readonly Role[]): Set<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]));
}

export function requiresMfa(roles: readonly Role[]): boolean {
  return roles.some((r) => MFA_REQUIRED_ROLES.has(r));
}

/**
 * Valida un conjunto de roles: al menos uno, sin repetidos y sin combinaciones prohibidas.
 * @returns lista de problemas (vacía si es válido), en español.
 */
export function validateRoleSet(roles: readonly string[]): string[] {
  const problems: string[] = [];
  if (roles.length === 0) problems.push('Debe asignar al menos un rol.');
  const unknown = roles.filter((r) => !isRole(r));
  if (unknown.length > 0) problems.push(`Roles desconocidos: ${unknown.join(', ')}.`);
  if (new Set(roles).size !== roles.length) problems.push('Hay roles repetidos.');
  for (const [a, b] of FORBIDDEN_ROLE_PAIRS) {
    if (roles.includes(a) && roles.includes(b)) {
      problems.push(`Separación de funciones: "${ROLE_LABELS[a]}" no puede combinarse con "${ROLE_LABELS[b]}".`);
    }
  }
  return problems;
}
