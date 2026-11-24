CREATE TYPE tipo_contenido AS ENUM ('TEXTO', 'ENLACE', 'VIDEO', 'DOCUMENTO');
CREATE TYPE estado_entrega AS ENUM ('BORRADOR', 'ENTREGADA', 'CALIFICADA', 'DEVUELTA');

ALTER TABLE clases ADD CONSTRAINT clases_id_institucion_key UNIQUE (id, institucion_id);
ALTER TABLE estudiantes ADD CONSTRAINT estudiantes_id_institucion_key UNIQUE (id, institucion_id);

CREATE TABLE cursos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institucion_id UUID NOT NULL REFERENCES instituciones(id),
    clase_id UUID NOT NULL UNIQUE,
    titulo VARCHAR(150) NOT NULL,
    descripcion TEXT,
    publicado BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT cursos_id_institucion_key UNIQUE (id, institucion_id),
    CONSTRAINT cursos_clase_id_fkey FOREIGN KEY (clase_id, institucion_id)
        REFERENCES clases (id, institucion_id) ON DELETE CASCADE
);

CREATE TABLE unidades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institucion_id UUID NOT NULL REFERENCES instituciones(id),
    curso_id UUID NOT NULL,
    orden INTEGER NOT NULL CHECK (orden >= 1 AND orden <= 200),
    titulo VARCHAR(150) NOT NULL,
    descripcion TEXT,
    publicada BOOLEAN NOT NULL DEFAULT FALSE,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unidades_id_institucion_key UNIQUE (id, institucion_id),
    CONSTRAINT unidades_curso_orden_key UNIQUE (curso_id, orden),
    CONSTRAINT unidades_curso_id_fkey FOREIGN KEY (curso_id, institucion_id)
        REFERENCES cursos (id, institucion_id) ON DELETE CASCADE
);

CREATE TABLE contenidos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institucion_id UUID NOT NULL REFERENCES instituciones(id),
    unidad_id UUID NOT NULL,
    orden INTEGER NOT NULL CHECK (orden >= 1 AND orden <= 500),
    titulo VARCHAR(150) NOT NULL,
    tipo tipo_contenido NOT NULL,
    cuerpo TEXT,
    url VARCHAR(500) CHECK (url IS NULL OR url ~ '^https://'),
    publicado BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT contenidos_unidad_orden_key UNIQUE (unidad_id, orden),
    CONSTRAINT contenidos_unidad_id_fkey FOREIGN KEY (unidad_id, institucion_id)
        REFERENCES unidades (id, institucion_id) ON DELETE CASCADE,
    CONSTRAINT contenidos_cuerpo_o_url CHECK (
        (tipo = 'TEXTO' AND cuerpo IS NOT NULL AND url IS NULL)
        OR (tipo <> 'TEXTO' AND url IS NOT NULL))
);

CREATE TABLE tareas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institucion_id UUID NOT NULL REFERENCES instituciones(id),
    curso_id UUID NOT NULL,
    unidad_id UUID,
    titulo VARCHAR(150) NOT NULL,
    instrucciones TEXT NOT NULL,
    puntaje_maximo NUMERIC(5,2) NOT NULL DEFAULT 100
        CHECK (puntaje_maximo > 0 AND puntaje_maximo <= 100),
    fecha_entrega TIMESTAMPTZ NOT NULL,
    permite_atraso BOOLEAN NOT NULL DEFAULT FALSE,
    publicada BOOLEAN NOT NULL DEFAULT FALSE,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tareas_id_institucion_key UNIQUE (id, institucion_id),
    CONSTRAINT tareas_curso_id_fkey FOREIGN KEY (curso_id, institucion_id)
        REFERENCES cursos (id, institucion_id) ON DELETE CASCADE,
    CONSTRAINT tareas_unidad_id_fkey FOREIGN KEY (unidad_id, institucion_id)
        REFERENCES unidades (id, institucion_id) ON DELETE SET NULL (unidad_id)
);

CREATE TABLE entregas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    institucion_id UUID NOT NULL REFERENCES instituciones(id),
    tarea_id UUID NOT NULL,
    estudiante_id UUID NOT NULL,
    texto TEXT,
    url VARCHAR(500) CHECK (url IS NULL OR url ~ '^https://'),
    estado estado_entrega NOT NULL DEFAULT 'BORRADOR',
    nota NUMERIC(5,2) CHECK (nota IS NULL OR (nota >= 0 AND nota <= 100)),
    retroalimentacion TEXT,
    entregada_en TIMESTAMPTZ,
    calificada_por UUID REFERENCES usuarios(id),
    calificada_en TIMESTAMPTZ,
    actualizada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT entregas_tarea_estudiante_key UNIQUE (tarea_id, estudiante_id),
    CONSTRAINT entregas_tarea_id_fkey FOREIGN KEY (tarea_id, institucion_id)
        REFERENCES tareas (id, institucion_id) ON DELETE CASCADE,
    CONSTRAINT entregas_estudiante_id_fkey FOREIGN KEY (estudiante_id, institucion_id)
        REFERENCES estudiantes (id, institucion_id) ON DELETE CASCADE,
    CONSTRAINT entregas_con_contenido CHECK (
        estado = 'BORRADOR' OR texto IS NOT NULL OR url IS NOT NULL),
    CONSTRAINT entregas_calificada_con_nota CHECK (
        estado <> 'CALIFICADA' OR (nota IS NOT NULL AND calificada_en IS NOT NULL))
);

CREATE FUNCTION exigir_nota_dentro_del_puntaje() RETURNS trigger AS $$
DECLARE
    tope NUMERIC(5,2);
BEGIN
    IF NEW.nota IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT puntaje_maximo INTO tope FROM tareas WHERE id = NEW.tarea_id;
    IF tope IS NOT NULL AND NEW.nota > tope THEN
        RAISE EXCEPTION 'La nota % pasa del puntaje maximo % de la tarea.', NEW.nota, tope
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entregas_nota_dentro_del_puntaje
    BEFORE INSERT OR UPDATE OF nota, tarea_id ON entregas
    FOR EACH ROW EXECUTE FUNCTION exigir_nota_dentro_del_puntaje();

CREATE FUNCTION exigir_puntaje_sobre_las_notas() RETURNS trigger AS $$
DECLARE
    mayor NUMERIC(5,2);
BEGIN
    IF NEW.puntaje_maximo >= OLD.puntaje_maximo THEN
        RETURN NEW;
    END IF;
    SELECT MAX(nota) INTO mayor FROM entregas WHERE tarea_id = NEW.id;
    IF mayor IS NOT NULL AND mayor > NEW.puntaje_maximo THEN
        RAISE EXCEPTION 'Ya hay una nota de % en esta tarea: el puntaje maximo no puede bajar a %.', mayor, NEW.puntaje_maximo
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tareas_puntaje_sobre_las_notas
    BEFORE UPDATE OF puntaje_maximo ON tareas
    FOR EACH ROW EXECUTE FUNCTION exigir_puntaje_sobre_las_notas();

CREATE INDEX unidades_por_curso ON unidades (curso_id, orden);
CREATE INDEX contenidos_por_unidad ON contenidos (unidad_id, orden);
CREATE INDEX tareas_por_curso ON tareas (curso_id, fecha_entrega);
CREATE INDEX entregas_por_tarea ON entregas (tarea_id, estado);
CREATE INDEX entregas_por_estudiante ON entregas (estudiante_id, actualizada_en DESC);

CREATE FUNCTION exigir_tarea_de_la_unidad() RETURNS trigger AS $$
DECLARE
    curso_de_la_unidad UUID;
BEGIN
    IF NEW.unidad_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT curso_id INTO curso_de_la_unidad FROM unidades WHERE id = NEW.unidad_id;
    IF curso_de_la_unidad IS NOT NULL AND curso_de_la_unidad IS DISTINCT FROM NEW.curso_id THEN
        RAISE EXCEPTION 'La unidad pertenece a otro curso.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tareas_unidad_del_mismo_curso
    BEFORE INSERT OR UPDATE OF curso_id, unidad_id ON tareas
    FOR EACH ROW EXECUTE FUNCTION exigir_tarea_de_la_unidad();

CREATE FUNCTION exigir_entrega_de_la_promocion() RETURNS trigger AS $$
DECLARE
    promocion_de_la_clase UUID;
    promocion_del_estudiante UUID;
BEGIN
    SELECT cl.promocion_id INTO promocion_de_la_clase
      FROM tareas t
      JOIN cursos cu ON cu.id = t.curso_id
      JOIN clases cl ON cl.id = cu.clase_id
     WHERE t.id = NEW.tarea_id;
    SELECT promocion_id INTO promocion_del_estudiante FROM estudiantes WHERE id = NEW.estudiante_id;
    IF promocion_de_la_clase IS DISTINCT FROM promocion_del_estudiante THEN
        RAISE EXCEPTION 'El estudiante no pertenece a la promocion de esta clase.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entregas_de_la_promocion
    BEFORE INSERT OR UPDATE OF tarea_id, estudiante_id ON entregas
    FOR EACH ROW EXECUTE FUNCTION exigir_entrega_de_la_promocion();

CREATE FUNCTION tocar_curso() RETURNS trigger AS $$
BEGIN
    NEW.actualizado_en := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cursos_actualizado_en
    BEFORE UPDATE ON cursos
    FOR EACH ROW EXECUTE FUNCTION tocar_curso();
