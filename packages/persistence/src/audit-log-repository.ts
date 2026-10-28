// SPDX-License-Identifier: AGPL-3.0-or-later

import { auditEntrySchema, createEntry, canonicalJson, type AuditEntry, type AuditEntryInput } from '@auditor-21719/audit-log';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DbEngine } from './config.js';
import type { AuditLogTable, TenantDatabase } from './schema.js';

const MAX_APPEND_ATTEMPTS = 8;

/** Tolerancia de reloj: una última entrada fechada más allá de esto en el futuro es sospechosa. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Detecta violación de clave única (otro proceso escribió el mismo `seq`). */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; number?: unknown };
  // PostgreSQL: SQLSTATE 23505. SQL Server: errores 2627 (PK/UNIQUE) y 2601 (índice único).
  return e.code === '23505' || e.number === 2627 || e.number === 2601;
}

function toEntry(row: AuditLogTable): AuditEntry {
  // PostgreSQL devuelve `bigint` como texto: se convierte verificando que sea un entero seguro.
  const seq = Number(row.seq);
  if (!Number.isSafeInteger(seq)) throw new Error(`Número de secuencia fuera de rango: ${String(row.seq)}`);
  return auditEntrySchema.parse({
    chainId: row.chain_id,
    seq,
    timestamp: row.ts,
    actor: row.actor,
    action: row.action,
    object: row.object,
    data: JSON.parse(row.data) as unknown,
    prevHash: row.prev_hash,
    hash: row.hash,
  });
}

function toRow(entry: AuditEntry): AuditLogTable {
  return {
    seq: entry.seq,
    chain_id: entry.chainId,
    ts: entry.timestamp,
    actor: entry.actor,
    action: entry.action,
    object: entry.object,
    data: canonicalJson(entry.data),
    prev_hash: entry.prevHash,
    hash: entry.hash,
  };
}

/**
 * Bitácora de una organización persistida en su propia base de datos.
 *
 * Garantías y límites:
 * - Cada entrada se encadena con la anterior (paquete `audit-log`).
 * - El usuario de aplicación solo tiene permisos SELECT e INSERT: no puede modificar ni
 *   borrar entradas aunque la aplicación tuviera un error.
 * - La cuenta administrativa del motor SÍ podría modificarlas: eso se detecta exportando
 *   y verificando con la CLI independiente contra anclajes externos (riesgo R-26).
 */
export class AuditLogRepository {
  constructor(
    private readonly db: Kysely<TenantDatabase>,
    private readonly engine: DbEngine,
    readonly chainId: string,
  ) {}

  /** Última entrada de la cadena, o `null` si está vacía. */
  async last(): Promise<AuditEntry | null> {
    return this.lastIn(this.db);
  }

  private async lastIn(db: Kysely<TenantDatabase> | Transaction<TenantDatabase>): Promise<AuditEntry | null> {
    const base = db.selectFrom('audit_log').selectAll().orderBy('seq', 'desc');
    // SQL Server no admite LIMIT; usa TOP.
    const row = this.engine === 'sqlserver' ? await base.top(1).executeTakeFirst() : await base.limit(1).executeTakeFirst();
    return row === undefined ? null : toEntry(row);
  }

  /**
   * Bloqueo exclusivo de escritura de la bitácora, liberado al terminar la transacción.
   * Serializa a todos los escritores (también de otros procesos) para que cada entrada
   * se encadene con la anterior real. Los bloqueos de aplicación no requieren permisos
   * adicionales para el usuario de la organización.
   */
  private async lock(trx: Transaction<TenantDatabase>): Promise<void> {
    if (this.engine === 'postgresql') {
      // Espera acotada, igual que en SQL Server (hallazgo QA B-04).
      await sql`SET LOCAL lock_timeout = '30s'`.execute(trx);
      await sql`SELECT pg_advisory_xact_lock(hashtext('auditor-21719:audit_log'))`.execute(trx);
    } else {
      await sql`DECLARE @r int; EXEC @r = sp_getapplock @Resource = 'auditor-21719:audit_log', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000; IF @r < 0 THROW 50001, 'No se obtuvo el bloqueo de la bitácora', 1;`.execute(trx);
    }
  }

  /**
   * Agrega una entrada dentro de una transacción con bloqueo exclusivo. La clave primaria
   * sobre `seq` queda como segunda barrera: si aun así hubiera un choque (p. ej. otra
   * herramienta escribiendo sin bloqueo), se reintenta.
   */
  async append(input: AuditEntryInput): Promise<AuditEntry> {
    for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
      try {
        return await this.db.transaction().execute(async (trx) => {
          await this.lock(trx);
          const previous = await this.lastIn(trx);
          const previousTime = previous === null ? 0 : Date.parse(previous.timestamp);
          // Una última entrada fechada en el futuro indica alteración o reloj erróneo: no se
          // propaga esa fecha a entradas legítimas nuevas (hallazgo QA B-02).
          if (previousTime > Date.now() + MAX_CLOCK_SKEW_MS) {
            throw new Error('La última entrada de la bitácora tiene fecha futura: posible alteración. Exporte y verifique la bitácora antes de continuar.');
          }
          // La marca de tiempo nunca retrocede, aunque el reloj del servidor se ajuste hacia
          // atrás dentro de la tolerancia: la verificación exige marcas no decrecientes.
          const now = new Date(Math.max(Date.now(), previousTime));
          const entry = createEntry(previous, this.chainId, input, now);
          await trx.insertInto('audit_log').values(toRow(entry)).execute();
          return entry;
        });
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === MAX_APPEND_ATTEMPTS) throw error;
      }
    }
    throw new Error('No se pudo agregar la entrada a la bitácora.');
  }

  /**
   * Todas las filas en orden, convertidas al formato de exportación SIN validarlas.
   *
   * A propósito no se valida ni se descarta nada: si alguien alteró la base, la
   * exportación debe mostrar exactamente lo que hay para que la CLI independiente lo
   * detecte. Validar aquí ocultaría la evidencia.
   */
  async exportRaw(): Promise<Record<string, unknown>[]> {
    const rows = await this.db.selectFrom('audit_log').selectAll().orderBy('seq', 'asc').execute();
    return rows.map((row) => {
      let data: unknown;
      try {
        data = JSON.parse(row.data);
      } catch {
        data = row.data;
      }
      return {
        chainId: row.chain_id,
        // Si el número no es un entero seguro se exporta como texto, sin perder dígitos: la
        // CLI de verificación lo reportará como formato inválido (hallazgo QA B-01).
        seq: Number.isSafeInteger(Number(row.seq)) ? Number(row.seq) : String(row.seq),
        timestamp: row.ts,
        actor: row.actor,
        action: row.action,
        object: row.object,
        data,
        prevHash: row.prev_hash,
        hash: row.hash,
      };
    });
  }
}
