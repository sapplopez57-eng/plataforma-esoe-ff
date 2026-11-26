ALTER TABLE tareas ADD COLUMN clave_idempotencia VARCHAR(64);
ALTER TABLE tareas ADD COLUMN huella_peticion CHAR(64);
ALTER TABLE tareas ADD CONSTRAINT tareas_idempotencia_completa
    CHECK ((clave_idempotencia IS NULL) = (huella_peticion IS NULL));
CREATE UNIQUE INDEX tareas_clave_idempotencia ON tareas (curso_id, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;
