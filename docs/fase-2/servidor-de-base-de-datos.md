# Preparación del servidor de base de datos (entrega 2A)

Esta guía es para **quien administra el motor de base de datos** de la institución (PostgreSQL o SQL Server). Se ejecuta **una vez**, antes de `auditor-admin init`, con una cuenta de superusuario (PostgreSQL) o `sysadmin` (SQL Server).

La plataforma **no usa** esa cuenta privilegiada. Usa una **cuenta de aprovisionamiento sin superusuario** que solo puede crear bases y usuarios, más un **usuario propio por organización** con privilegios mínimos. [DECISIÓN D-65]

En el perfil Docker Compose local todo esto lo hace automáticamente `deploy/compose/postgres-init/10-auditor-provisioner.sh` al crear el volumen de datos. Si su volumen se creó **antes** de esta versión, ejecute a mano la sección 1.

Reemplace `<CONTRASEÑA>` por una contraseña larga y aleatoria. Guárdela solo en el archivo de secreto que leerá `auditor-admin` (`DB_ADMIN_PASSWORD_FILE`); nunca en el repositorio.

## 1. PostgreSQL (probado con PostgreSQL 18)

Conéctese como superusuario a la base `postgres` (por ejemplo, `psql -U postgres -d postgres`) y ejecute:

```sql
-- 1. Cuenta de aprovisionamiento: crea bases y usuarios de organizaciones; NO es superusuario.
CREATE ROLE auditor_provisioner LOGIN CREATEDB CREATEROLE NOSUPERUSER NOREPLICATION NOBYPASSRLS
  PASSWORD '<CONTRASEÑA>';

-- 2. Le permite cerrar las sesiones abiertas de una organización al suspenderla.
GRANT pg_signal_backend TO auditor_provisioner;

-- 3. Por defecto PostgreSQL deja que CUALQUIER usuario se conecte a "postgres" y "template1".
--    Se revoca, y solo la cuenta de aprovisionamiento puede entrar a "postgres".
REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE template1 FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO auditor_provisioner;

-- 4. Las bases nuevas se copian de template1. Se quitan los objetos grandes ("large
--    objects"), que serían un canal de escritura fuera de la bitácora.
\connect template1
REVOKE EXECUTE ON FUNCTION lo_creat(integer), lo_create(oid), lo_from_bytea(oid, bytea),
  lo_import(text), lo_import(text, oid) FROM PUBLIC;
```

Si en el servidor existen otras bases ajenas a la plataforma, revise también que no permitan conexión a `PUBLIC`. `auditor-admin init` lo advierte: lista cada base a la que cualquier usuario puede conectarse.

**Qué hace la plataforma con esta cuenta** (verificado en las pruebas de integración, que se ejecutan con una cuenta así y comprueban que no es superusuario):

- Crea la base de control (`auditor_control`) y le quita el acceso público.
- Por cada organización:
  - crea una base y un usuario con **nombres aleatorios opacos** (p. ej. `auditor_t_836cec1cff81`), que no revelan el identificador de la organización;
  - concede al usuario CONNECT solo a su base, y dentro de ella solo SELECT e INSERT en la bitácora y SELECT en `organization`.
- Al suspender: `ALTER ROLE … NOLOGIN` y cierre de sesiones abiertas.

## 2. SQL Server (probado con SQL Server 2025 CU10 Developer en CI)

Conéctese como `sysadmin` a `master` y ejecute:

```sql
CREATE LOGIN auditor_provisioner WITH PASSWORD = '<CONTRASEÑA>', CHECK_POLICY = ON;
-- Crear y eliminar bases de organizaciones.
ALTER SERVER ROLE dbcreator ADD MEMBER auditor_provisioner;
-- Crear y deshabilitar logins de organizaciones y negarles VIEW ANY DATABASE.
ALTER SERVER ROLE securityadmin ADD MEMBER auditor_provisioner;
-- Cerrar sesiones de una organización suspendida (KILL).
ALTER SERVER ROLE processadmin ADD MEMBER auditor_provisioner;
```

**Advertencia: en SQL Server esta cuenta sigue siendo muy poderosa.** La documentación de Microsoft dice textualmente "Treat the securityadmin role as equivalent to the sysadmin role", y que `dbcreator` "can create, alter, drop, and restore any database" (cualquier base, no solo las de la plataforma). [VERIFICADO: [Server-level roles, Microsoft Learn](https://learn.microsoft.com/en-us/sql/relational-databases/security/authentication-access/server-level-roles), consultado el 28-10-2026]

Por eso, en SQL Server la separación respecto de `sa` aporta trazabilidad y menos superficie accidental, **pero no un límite de seguridad fuerte**. La mejora real de A-02 en ese motor es que la API que atiende HTTP ya no recibe esta cuenta.

[PENDIENTE: evaluar en 2C permisos más finos (`CREATE ANY DATABASE`, `ALTER ANY LOGIN`, `ALTER ANY CONNECTION`) o el rol `##MS_LoginManager##` (SQL Server 2022+), que Microsoft sugiere como alternativa a `securityadmin`.]

**Qué hace la plataforma:**

- Cada login de organización recibe `DENY VIEW ANY DATABASE`: no puede listar las bases del servidor (probado).
- En la base de control se ejecuta `REVOKE CONNECT FROM guest`.
- Al suspender: `ALTER LOGIN … DISABLE` y `KILL` de sus sesiones.

**Riesgo residual:** el usuario invitado (`guest`) de `master` y `tempdb` es propio del motor y no puede deshabilitarse. Un login de organización puede conectarse a ellas y ver metadatos públicos, pero no los nombres de otras bases.

## 3. Riesgos residuales comunes

- **El usuario de una organización puede cambiar su propia contraseña.** PostgreSQL y SQL Server lo permiten y no se puede impedir. En PostgreSQL también puede fijarse parámetros de sesión. Si lo hace, la plataforma pierde acceso a esa base (R-31). Mitigación:
  - `auditor-admin tenant check` lo detecta;
  - `auditor-admin tenant rotate-password --slug <id>` fija una contraseña nueva y, en PostgreSQL, borra esos parámetros (`ALTER ROLE … RESET ALL`);
  - la plataforma además fija `search_path=public` en cada conexión.
- **Catálogo visible en PostgreSQL:** `pg_database` y `pg_roles` son visibles para todos los usuarios (R-32). Por eso los nombres de bases y usuarios son opacos. El nombre de la base de control (`auditor_control`) sí es visible, pero su acceso está revocado.
- **La cuenta de aprovisionamiento es dueña de las bases de organizaciones** y puede modificar su contenido, incluida la bitácora. Mitigación: verificación de la exportación contra anclajes externos (R-26).
