CREATE TABLE instituciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo VARCHAR(20) UNIQUE NOT NULL CHECK (codigo ~ '^[A-Z0-9][A-Z0-9-]*$'),
    siglas VARCHAR(20) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN (
        'ESCUELA_MILITAR', 'UNIVERSIDAD', 'FORMACION_PROFESIONAL', 'GESTION_DE_RIESGO', 'OTRA')),
    sitio_web VARCHAR(300) CHECK (sitio_web IS NULL OR sitio_web ~ '^https://'),
    campus_virtual VARCHAR(300) CHECK (campus_virtual IS NULL OR campus_virtual ~ '^https://'),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    creada_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO instituciones (codigo, siglas, nombre, tipo, sitio_web, campus_virtual) VALUES
    ('ESOE', 'ESOE', 'Escuela de Suboficiales del Ejército', 'ESCUELA_MILITAR', NULL, NULL),
    ('UDH', 'UDH', 'Universidad de Defensa de Honduras', 'UNIVERSIDAD',
        NULL, 'https://aula.udh.edu.hn'),
    ('INFOP', 'INFOP', 'Instituto Nacional de Formación Profesional', 'FORMACION_PROFESIONAL',
        NULL, 'https://plataformavirtual.infop.hn'),
    ('COPECO', 'COPECO', 'Comisión Permanente de Contingencias', 'GESTION_DE_RIESGO',
        NULL, 'https://cenicac.copeco.gob.hn');

CREATE FUNCTION institucion_predeterminada() RETURNS UUID AS $$
    SELECT id FROM instituciones WHERE codigo = 'ESOE';
$$ LANGUAGE sql STABLE;

ALTER TABLE usuarios
    ADD COLUMN institucion_id UUID NOT NULL DEFAULT institucion_predeterminada() REFERENCES instituciones(id);
ALTER TABLE periodos_lectivos
    ADD COLUMN institucion_id UUID NOT NULL DEFAULT institucion_predeterminada() REFERENCES instituciones(id);
ALTER TABLE promociones
    ADD COLUMN institucion_id UUID NOT NULL DEFAULT institucion_predeterminada() REFERENCES instituciones(id);
ALTER TABLE materias
    ADD COLUMN institucion_id UUID NOT NULL DEFAULT institucion_predeterminada() REFERENCES instituciones(id);
ALTER TABLE catedraticos
    ADD COLUMN institucion_id UUID NOT NULL DEFAULT institucion_predeterminada() REFERENCES instituciones(id);
ALTER TABLE estudiantes
    ADD COLUMN institucion_id UUID NOT NULL DEFAULT institucion_predeterminada() REFERENCES instituciones(id);
ALTER TABLE clases
    ADD COLUMN institucion_id UUID NOT NULL DEFAULT institucion_predeterminada() REFERENCES instituciones(id);
ALTER TABLE plataformas_externas
    ADD COLUMN institucion_id UUID NOT NULL DEFAULT institucion_predeterminada() REFERENCES instituciones(id);

CREATE INDEX usuarios_por_institucion ON usuarios (institucion_id);
CREATE INDEX periodos_por_institucion ON periodos_lectivos (institucion_id);
CREATE INDEX promociones_por_institucion ON promociones (institucion_id);
CREATE INDEX materias_por_institucion ON materias (institucion_id);
CREATE INDEX catedraticos_por_institucion ON catedraticos (institucion_id);
CREATE INDEX estudiantes_por_institucion ON estudiantes (institucion_id, promocion_id);
CREATE INDEX clases_por_institucion ON clases (institucion_id);
CREATE INDEX plataformas_por_institucion ON plataformas_externas (institucion_id);

ALTER TABLE periodos_lectivos DROP CONSTRAINT periodos_lectivos_codigo_key,
    ADD CONSTRAINT periodos_lectivos_institucion_codigo_key UNIQUE (institucion_id, codigo);
ALTER TABLE promociones DROP CONSTRAINT promociones_codigo_key,
    ADD CONSTRAINT promociones_institucion_codigo_key UNIQUE (institucion_id, codigo);
ALTER TABLE materias DROP CONSTRAINT materias_codigo_key,
    ADD CONSTRAINT materias_institucion_codigo_key UNIQUE (institucion_id, codigo);
ALTER TABLE catedraticos DROP CONSTRAINT catedraticos_dni_key,
    ADD CONSTRAINT catedraticos_institucion_dni_key UNIQUE (institucion_id, dni);
ALTER TABLE estudiantes DROP CONSTRAINT estudiantes_codigo_alumno_key,
    DROP CONSTRAINT estudiantes_dni_key,
    ADD CONSTRAINT estudiantes_institucion_codigo_alumno_key UNIQUE (institucion_id, codigo_alumno),
    ADD CONSTRAINT estudiantes_institucion_dni_key UNIQUE (institucion_id, dni);
ALTER TABLE clases DROP CONSTRAINT clases_codigo_clase_key,
    ADD CONSTRAINT clases_institucion_codigo_clase_key UNIQUE (institucion_id, codigo_clase);

ALTER TABLE periodos_lectivos ADD CONSTRAINT periodos_lectivos_id_institucion_key UNIQUE (id, institucion_id);
ALTER TABLE promociones ADD CONSTRAINT promociones_id_institucion_key UNIQUE (id, institucion_id);
ALTER TABLE materias ADD CONSTRAINT materias_id_institucion_key UNIQUE (id, institucion_id);
ALTER TABLE catedraticos ADD CONSTRAINT catedraticos_id_institucion_key UNIQUE (id, institucion_id);

ALTER TABLE estudiantes DROP CONSTRAINT estudiantes_promocion_id_fkey,
    ADD CONSTRAINT estudiantes_promocion_id_fkey FOREIGN KEY (promocion_id, institucion_id)
        REFERENCES promociones (id, institucion_id);

ALTER TABLE clases
    DROP CONSTRAINT clases_periodo_id_fkey,
    DROP CONSTRAINT clases_promocion_id_fkey,
    DROP CONSTRAINT clases_materia_id_fkey,
    DROP CONSTRAINT clases_catedratico_id_fkey,
    ADD CONSTRAINT clases_periodo_id_fkey FOREIGN KEY (periodo_id, institucion_id)
        REFERENCES periodos_lectivos (id, institucion_id),
    ADD CONSTRAINT clases_promocion_id_fkey FOREIGN KEY (promocion_id, institucion_id)
        REFERENCES promociones (id, institucion_id),
    ADD CONSTRAINT clases_materia_id_fkey FOREIGN KEY (materia_id, institucion_id)
        REFERENCES materias (id, institucion_id),
    ADD CONSTRAINT clases_catedratico_id_fkey FOREIGN KEY (catedratico_id, institucion_id)
        REFERENCES catedraticos (id, institucion_id);

CREATE FUNCTION exigir_misma_institucion() RETURNS trigger AS $$
DECLARE
    de_la_clase UUID;
    del_estudiante UUID;
BEGIN
    IF TG_TABLE_NAME = 'detalle_asistencia' THEN
        SELECT c.institucion_id INTO de_la_clase
          FROM sesiones_asistencia s JOIN clases c ON c.id = s.clase_id
         WHERE s.id = NEW.sesion_id;
    ELSE
        SELECT institucion_id INTO de_la_clase FROM clases WHERE id = NEW.clase_id;
    END IF;
    SELECT institucion_id INTO del_estudiante FROM estudiantes WHERE id = NEW.estudiante_id;
    IF de_la_clase IS DISTINCT FROM del_estudiante THEN
        RAISE EXCEPTION 'La clase y el estudiante son de instituciones distintas.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calificaciones_misma_institucion
    BEFORE INSERT OR UPDATE OF clase_id, estudiante_id ON calificaciones
    FOR EACH ROW EXECUTE FUNCTION exigir_misma_institucion();

CREATE TRIGGER asistencia_misma_institucion
    BEFORE INSERT OR UPDATE OF sesion_id, estudiante_id ON detalle_asistencia
    FOR EACH ROW EXECUTE FUNCTION exigir_misma_institucion();
