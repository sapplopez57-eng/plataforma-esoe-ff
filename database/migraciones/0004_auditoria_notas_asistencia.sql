CREATE TABLE auditoria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tabla VARCHAR(40) NOT NULL,
    registro_id UUID NOT NULL,
    clase_id UUID NOT NULL,
    estudiante_id UUID NOT NULL,
    campo VARCHAR(40) NOT NULL,
    valor_anterior TEXT,
    valor_nuevo TEXT,
    usuario_id UUID,
    autor VARCHAR(120) NOT NULL,
    cambiado_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX auditoria_por_clase ON auditoria (clase_id, cambiado_en DESC);
CREATE INDEX auditoria_por_estudiante ON auditoria (estudiante_id, cambiado_en DESC);

CREATE FUNCTION auditoria_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'La auditoria no se modifica ni se borra.' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditoria_solo_crece
    BEFORE UPDATE OR DELETE ON auditoria
    FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();

CREATE FUNCTION auditoria_usuario() RETURNS UUID AS $$
    SELECT NULLIF(current_setting('esoe.usuario_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION auditoria_autor() RETURNS VARCHAR AS $$
    SELECT COALESCE(NULLIF(current_setting('esoe.autor', true), ''), 'sql:' || session_user);
$$ LANGUAGE sql STABLE;

CREATE FUNCTION auditar_calificacion() RETURNS trigger AS $$
DECLARE
    campo TEXT;
    antes TEXT;
    despues TEXT;
BEGIN
    FOREACH campo IN ARRAY ARRAY['parcial_1', 'parcial_2', 'parcial_3', 'acumulativo'] LOOP
        despues := to_jsonb(NEW) ->> campo;
        antes := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> campo END;
        IF antes IS DISTINCT FROM despues THEN
            INSERT INTO auditoria (tabla, registro_id, clase_id, estudiante_id, campo,
                                   valor_anterior, valor_nuevo, usuario_id, autor)
            VALUES ('calificaciones', NEW.id, NEW.clase_id, NEW.estudiante_id, campo,
                    antes, despues, auditoria_usuario(), auditoria_autor());
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calificaciones_auditadas
    AFTER INSERT OR UPDATE ON calificaciones
    FOR EACH ROW EXECUTE FUNCTION auditar_calificacion();

CREATE FUNCTION auditar_asistencia() RETURNS trigger AS $$
DECLARE
    campo TEXT;
    antes TEXT;
    despues TEXT;
    clase UUID;
BEGIN
    SELECT clase_id INTO clase FROM sesiones_asistencia WHERE id = NEW.sesion_id;
    FOREACH campo IN ARRAY ARRAY['estado', 'observacion'] LOOP
        despues := to_jsonb(NEW) ->> campo;
        antes := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> campo END;
        IF antes IS DISTINCT FROM despues THEN
            INSERT INTO auditoria (tabla, registro_id, clase_id, estudiante_id, campo,
                                   valor_anterior, valor_nuevo, usuario_id, autor)
            VALUES ('detalle_asistencia', NEW.id, clase, NEW.estudiante_id, campo,
                    antes, despues, auditoria_usuario(), auditoria_autor());
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asistencia_auditada
    AFTER INSERT OR UPDATE ON detalle_asistencia
    FOR EACH ROW EXECUTE FUNCTION auditar_asistencia();
