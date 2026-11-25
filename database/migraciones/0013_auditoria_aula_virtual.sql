CREATE FUNCTION auditar_entrega() RETURNS trigger AS $$
DECLARE
    campo TEXT;
    antes TEXT;
    despues TEXT;
    clase UUID;
BEGIN
    SELECT c.clase_id INTO clase
    FROM tareas t JOIN cursos c ON c.id = t.curso_id AND c.institucion_id = t.institucion_id
    WHERE t.id = NEW.tarea_id AND t.institucion_id = NEW.institucion_id;
    IF clase IS NULL THEN
        RAISE EXCEPTION 'La entrega % no resuelve una clase auditable.', NEW.id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    FOREACH campo IN ARRAY ARRAY['nota', 'estado', 'retroalimentacion'] LOOP
        despues := to_jsonb(NEW) ->> campo;
        antes := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> campo END;
        IF antes IS DISTINCT FROM despues THEN
            INSERT INTO auditoria (tabla, registro_id, clase_id, estudiante_id, campo,
                                   valor_anterior, valor_nuevo, usuario_id, autor)
            VALUES ('entregas', NEW.id, clase, NEW.estudiante_id, campo,
                    antes, despues, auditoria_usuario(), auditoria_autor());
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entregas_auditadas
    AFTER INSERT OR UPDATE ON entregas
    FOR EACH ROW EXECUTE FUNCTION auditar_entrega();

CREATE FUNCTION auditar_puntaje_tarea() RETURNS trigger AS $$
DECLARE
    clase UUID;
BEGIN
    IF NEW.puntaje_maximo IS NOT DISTINCT FROM OLD.puntaje_maximo THEN
        RETURN NEW;
    END IF;
    SELECT c.clase_id INTO clase
    FROM cursos c WHERE c.id = NEW.curso_id AND c.institucion_id = NEW.institucion_id;
    IF clase IS NULL THEN
        RAISE EXCEPTION 'La tarea % no resuelve una clase auditable.', NEW.id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    INSERT INTO auditoria (tabla, registro_id, clase_id, estudiante_id, campo,
                           valor_anterior, valor_nuevo, usuario_id, autor)
    SELECT 'tareas', NEW.id, clase, e.estudiante_id, 'puntaje_maximo',
           OLD.puntaje_maximo::text, NEW.puntaje_maximo::text,
           auditoria_usuario(), auditoria_autor()
    FROM entregas e
    WHERE e.tarea_id = NEW.id AND e.institucion_id = NEW.institucion_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tareas_puntaje_auditado
    AFTER UPDATE OF puntaje_maximo ON tareas
    FOR EACH ROW EXECUTE FUNCTION auditar_puntaje_tarea();
